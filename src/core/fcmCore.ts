import { FCMError, isFCMError, toFCMError } from './errors.js'
import { EventBuffer } from './eventBuffer.js'
import { CountingEventTarget, NOTIFICATION_EVENT, TOKEN_REFRESH_EVENT } from './eventTarget.js'
import { sanitizeNotificationPayload } from './payload.js'
import type {
    IChannelConfiguration,
    IDisposable,
    IFCMOptions,
    IForegroundPresentationOptions,
    INotificationPayload,
    IListenOptions,
    IPluginBridge,
    IRequestPushPermissionOptions,
    NativeEvent,
    PlatformId
} from './types.js'

const DEFAULT_CALL_TIMEOUT_MS = 15_000
const TOKEN_BUFFER_SIZE = 1

/**
 * FCM topic names: the documented Firebase ASCII set, with no restriction on the
 * first character — a leading digit is valid ("9lives" is a legal topic name).
 */
const TOPIC_PATTERN = /^[a-zA-Z0-9\-_.~%]{1,900}$/
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/

type Listener<T> = { callback: (value: T) => void; once: boolean }

/**
 * One initialization attempt, keyed by the bridge generation it attached.
 * `settled` is what separates "fail this handshake" from "recover a healthy one":
 * while the attempt is still running there is a promise to reject, afterwards
 * there isn't and recovery has to reattach on its own.
 */
type StreamAttempt = {
    /** True only once every handshake step has actually completed. */
    settled: boolean
    transportFailure?: FCMError
    /** Bound after creation; used only to compare memo identity. */
    promise?: Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/** Native bridges disagree about booleans; Android has been seen sending 0/1. */
const toBoolean = (value: unknown): boolean => {
    if (typeof value === 'boolean') {
        return value
    }
    if (typeof value === 'number') {
        return value !== 0
    }
    if (typeof value === 'string') {
        const normalised = value.trim().toLowerCase()
        return normalised === 'true' || normalised === '1'
    }
    return false
}

const notifySafely = <T>(
    listener: Listener<T>,
    value: T,
    onError: (error: unknown) => void
): boolean => {
    try {
        listener.callback(value)
        return true
    } catch (error) {
        onError(error)
        return false
    }
}

/**
 * Runtime-agnostic FCM facade. Everything that is not transport lives here, so
 * Cordova, Capacitor and the tests share one implementation of the semantics.
 */
export class FCMCore {
    public readonly eventTarget: CountingEventTarget
    public readonly platformId: PlatformId

    private readonly notificationListeners: Array<Listener<INotificationPayload>> = []
    private readonly tokenListeners: Array<Listener<string>> = []
    private readonly notifications: EventBuffer
    private readonly tokens: EventBuffer
    private readonly options: Required<
        Pick<
            IFCMOptions,
            'autoInitialize' | 'eventBufferSize' | 'dedupCacheSize' | 'autoSubscribeTopics'
        >
    > & {
        callTimeoutMs: number
        foregroundPresentation?: IForegroundPresentationOptions
    }

    private initPromise: Promise<void> | null = null
    private bridgeTeardown: (() => void) | null = null
    /**
     * Bumped whenever the event stream is re-attached. A transport error callback
     * captured by an older generation can still arrive after its teardown ran;
     * the generation lets recovery ignore those stale callbacks instead of
     * tearing down the newer bridge.
     */
    private bridgeGeneration = 0
    private readonly attempts = new Map<number, StreamAttempt>()
    private initialPayloadCache: INotificationPayload | null | undefined
    private disposed = false
    private readonly bridge: IPluginBridge
    private readonly replayPending: { notification: boolean; tokenRefresh: boolean } = {
        notification: false,
        tokenRefresh: false
    }

    constructor(bridge: IPluginBridge, options: IFCMOptions & { callTimeoutMs?: number } = {}) {
        this.bridge = bridge
        this.options = {
            autoInitialize: options.autoInitialize ?? true,
            eventBufferSize: options.eventBufferSize ?? 20,
            dedupCacheSize: options.dedupCacheSize ?? 100,
            autoSubscribeTopics: options.autoSubscribeTopics ?? [],
            callTimeoutMs: options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
            foregroundPresentation: options.foregroundPresentation
        }
        this.eventTarget = new CountingEventTarget()
        // A listener attached directly on the event target is a subscriber too,
        // so it has to trigger replay exactly like onNotification() does.
        this.eventTarget.setOnSubscribe((type) =>
            this.scheduleReplay(type === NOTIFICATION_EVENT ? 'notification' : 'tokenRefresh')
        )
        this.platformId = bridge.platformId
        this.notifications = new EventBuffer(
            this.options.eventBufferSize,
            this.options.dedupCacheSize
        )
        this.tokens = new EventBuffer(TOKEN_BUFFER_SIZE, this.options.dedupCacheSize)
        if (this.options.autoInitialize) {
            // Never throws synchronously: failures surface through the API that
            // awaits them, so importing this module can't crash an app.
            void this.initialize().catch(() => undefined)
        }
    }

    public get platform(): PlatformId {
        return this.bridge.platformId
    }

    /** Starts (or reuses) the native handshake. Safe to call repeatedly. */
    public initialize(): Promise<void> {
        if (this.disposed) {
            return Promise.reject(
                new FCMError('not_initialized', 'This FCM instance has been disposed')
            )
        }
        if (this.initPromise !== null) {
            return this.initPromise
        }
        const generation = this.bridgeGeneration + 1
        const handshake = this.runInitialization()
        if (handshake === null) {
            return Promise.reject(
                new FCMError('not_initialized', 'This FCM instance has been disposed')
            )
        }
        // The attempt's memo identity must be the *exact* promise later calls
        // reuse, so recovery can tell "this generation owns the memo" from "a
        // newer generation replaced it". Binding the inner handshake promise here
        // would compare two different objects and never clear the memo.
        const pending = handshake.catch((error: unknown) => {
            // Clear the memo so a later call can retry after a transient failure
            // instead of sticking every future call to one rejected promise.
            if (this.initPromise === pending) {
                this.initPromise = null
            }
            throw error
        })
        this.initPromise = pending
        const attempt = this.attempts.get(generation)
        if (attempt !== undefined) {
            attempt.promise = pending
        }
        return pending
    }

    public ready(): Promise<void> {
        return this.initialize()
    }

    /**
     * The event stream can die after the handshake settled (Cordova's keep-alive
     * error callback arrives whenever native drops the sink). `initPromise` is a
     * settled memo, so without recovery every later `ready`/`getToken` reports
     * success while there is no notification sink at all.
     *
     * Which of two shapes applies depends on whether the failing attempt has
     * already settled. While a handshake is still in flight the failure is
     * recorded for *that* attempt and fails its own promise (native answering
     * `ready` must not mask a dead sink); once it has settled there is no promise
     * left to fail, so recovery detaches, retires the memo and reattaches.
     */
    private handleStreamFailure(error: FCMError, generation: number): void {
        if (this.disposed || generation !== this.bridgeGeneration) {
            return
        }
        const failedAttempt = this.attempts.get(generation)
        // A teardown this class initiated (dispose, or a recovery that already
        // bumped the generation) leaves no live attempt for this generation.
        if (failedAttempt === undefined) {
            return
        }
        if (!failedAttempt.settled) {
            // The handshake is still running, so there is a promise to fail:
            // performHandshake's checkpoints pick this up.
            failedAttempt.transportFailure ??= error
            return
        }
        this.retireAttempt(generation)
        // Clearing the memo is what makes a later call reattach. Comparing by
        // identity (not by "is this promise settled") keeps a stale generation
        // from clearing a newer attempt's memo.
        if (this.initPromise === failedAttempt.promise) {
            this.initPromise = null
        }
        // Reattach eagerly: an app that never calls a native API again should
        // still receive the next notification. A failed reattach leaves the memo
        // cleared, so the next `ready()`/native call retries.
        void this.initialize().catch(() => undefined)
    }

    /** Detaches the stream of `generation` unless a newer attempt already owns it. */
    private retireAttempt(generation: number): void {
        this.attempts.delete(generation)
        if (generation !== this.bridgeGeneration) {
            return
        }
        this.teardownBridge()
        this.bridgeGeneration++
    }

    /**
     * The handshake proper. Kept separate from `initialize()` so the attempt's
     * bookkeeping — registering it, then marking it settled at its real
     * completion boundary — lives in one place.
     */
    private async performHandshake(attempt: StreamAttempt, generation: number): Promise<void> {
        const takeTransportFailure = (): FCMError | null => {
            const failure = attempt.transportFailure
            attempt.transportFailure = undefined
            return failure ?? null
        }
        // Attach the event bridge *before* asking native to replay, otherwise a
        // cold-start burst is emitted into a world with no receiver.
        this.bridgeTeardown = this.bridge.addEventListener(
            (event) => {
                if (generation === this.bridgeGeneration) {
                    this.handleNativeEvent(event)
                }
            },
            (error) => this.handleStreamFailure(error, generation)
        )
        try {
            // Capacitor's addListener is asynchronous: until that promise settles
            // the native side has nowhere to deliver, so replay must wait for it.
            await this.awaitEventRegistration()
            const registrationFailure = takeTransportFailure()
            if (registrationFailure !== null) {
                throw registrationFailure
            }
            await this.callNative<void>('ready')
            const readyFailure = takeTransportFailure()
            if (readyFailure !== null) {
                // `ready` answered, but the event stream died in the same
                // handshake: the plugin is not usable yet.
                throw readyFailure
            }
        } catch (error) {
            this.retireAttempt(generation)
            // A timeout is a distinct diagnosis ("the native side never answered")
            // and must not be flattened into "the bridge is offline".
            if (isFCMError(error) && error.code === 'timeout') {
                throw error
            }
            const reason = toFCMError(
                'bridge_unavailable',
                error,
                'FCM native bridge is not available',
                this.platformId
            )
            throw new FCMError('bridge_unavailable', reason.message, {
                platform: this.platformId,
                cause: error
            })
        }
        if (this.options.foregroundPresentation) {
            await this.callNative<void>('setForegroundPresentation', [
                this.options.foregroundPresentation
            ])
        }
        for (const topic of this.options.autoSubscribeTopics) {
            // Deliberately *not* this.subscribeToTopic(): that awaits initialize(),
            // which is the promise currently running — it would deadlock.
            this.assertTopic(topic)
            await this.callNative<void>('subscribeToTopic', [topic])
        }
        await this.callNative<void>('replayBufferedEvents')
    }

    private runInitialization(): Promise<void> | null {
        if (this.disposed) {
            return null
        }
        if (this.bridge.runtime === 'web') {
            return Promise.reject(
                new FCMError(
                    'unsupported_platform',
                    'This build has no browser push implementation',
                    {
                        platform: this.bridge.platformId
                    }
                )
            )
        }
        // The event stream has its own failure channel: Cordova's
        // `startJsEventBridge` reports through the keep-alive error callback, which
        // never rejects the `ready` promise. A handshake that ignores it would
        // report success while the app silently had no sink, so the first transport
        // failure is captured and fails this initialization instead.
        const generation = ++this.bridgeGeneration
        const attempt: StreamAttempt = { settled: false }
        this.attempts.set(generation, attempt)
        // The handshake really finished, so the stream is now an established sink
        // whose later death is a recovery case rather than a startup failure. Any
        // failure reported while the last await was still in flight is handed to
        // recovery here.
        const settled = this.performHandshake(attempt, generation).then(
            () => {
                attempt.settled = true
                const late = attempt.transportFailure
                if (late !== undefined && this.attempts.get(generation) === attempt) {
                    attempt.transportFailure = undefined
                    this.handleStreamFailure(late, generation)
                }
            },
            (error: unknown) => {
                // Failed attempts are retired above, in performHandshake.
                throw error
            }
        )
        // `settled` is the promise that carries the "the handshake completed"
        // classification, so it must be observed before any caller of
        // initialize() resumes. Chaining it *before* returning does exactly that:
        // a caller's continuation is attached later and therefore runs after the
        // flag is armed, which is what makes a synchronous break right after
        // `await core.initialize()` take the recovery path instead of recording a
        // failure nobody was left to read.
        return settled.then(() => undefined)
    }

    private teardownBridge(): void {
        if (this.bridgeTeardown !== null) {
            try {
                this.bridgeTeardown()
            } catch {
                // teardown must never break a call path
            }
            this.bridgeTeardown = null
        }
    }

    /** Releases the bridge and all listeners. Idempotent. */
    public dispose(): void {
        if (this.disposed) {
            return
        }
        this.disposed = true
        this.teardownBridge()
        this.bridgeGeneration++
        this.attempts.clear()
        this.notificationListeners.length = 0
        this.tokenListeners.length = 0
        this.notifications.drain()
        this.tokens.drain()
    }

    // ---------------------------------------------------------------- events

    private subscriberCount(kind: 'notification' | 'tokenRefresh'): number {
        if (kind === 'notification') {
            return (
                this.notificationListeners.length +
                this.eventTarget.subscriberCount(NOTIFICATION_EVENT)
            )
        }
        return this.tokenListeners.length + this.eventTarget.subscriberCount(TOKEN_REFRESH_EVENT)
    }

    private handleNativeEvent(event: NativeEvent): void {
        if (this.disposed) {
            return
        }
        let normalized: NativeEvent
        let buffer: EventBuffer
        if (event.kind === 'tokenRefresh') {
            const token = typeof event.token === 'string' ? event.token : ''
            if (token.length === 0) {
                return
            }
            normalized = { kind: 'tokenRefresh', token }
            buffer = this.tokens
        } else {
            const payload = sanitizeNotificationPayload(event.payload)
            if (payload === null) {
                return
            }
            normalized = { kind: 'notification', payload }
            buffer = this.notifications
        }
        const kind = normalized.kind === 'notification' ? 'notification' : 'tokenRefresh'

        // Dedup gates *every* accepted event (live or buffered), so a live
        // duplicate can never reach a listener twice.
        if (!buffer.tryAccept(normalized)) {
            return
        }
        // Nobody listening yet, or a replay is already in flight: queue it so the
        // order stays chronological instead of the live event jumping the queue.
        if (this.subscriberCount(kind) === 0 || this.replayPending[kind]) {
            buffer.enqueue(normalized)
            return
        }
        this.emit(normalized)
    }

    private emit(event: NativeEvent): void {
        if (event.kind === 'notification') {
            this.dispatch(NOTIFICATION_EVENT, event.payload)
            this.deliverNotification(event)
            return
        }
        this.dispatch(TOKEN_REFRESH_EVENT, event.token)
        this.deliverToken(event)
    }

    private deliverNotification(event: Extract<NativeEvent, { kind: 'notification' }>): void {
        const listeners = [...this.notificationListeners]
        for (const listener of listeners) {
            const index = this.notificationListeners.indexOf(listener)
            if (listener.once && index >= 0) {
                this.notificationListeners.splice(index, 1)
            }
            notifySafely(listener, event.payload, () => undefined)
        }
    }

    private deliverToken(event: Extract<NativeEvent, { kind: 'tokenRefresh' }>): void {
        const listeners = [...this.tokenListeners]
        for (const listener of listeners) {
            const index = this.tokenListeners.indexOf(listener)
            if (listener.once && index >= 0) {
                this.tokenListeners.splice(index, 1)
            }
            notifySafely(listener, event.token, () => undefined)
        }
    }

    private dispatch(name: string, detail: unknown): void {
        try {
            this.eventTarget.dispatchEvent(new CustomEvent(name, { detail }))
        } catch {
            // A host without CustomEvent still gets the callback form.
        }
    }

    /**
     * Replay is deferred to the next microtask so that attaching several listeners
     * in one tick replays to all of them, and so that disposing before the replay
     * runs means nothing is delivered at all.
     *
     * The queue is drained only as far as there are subscribers: a `once`
     * listener consumes one event and the rest stay buffered for the next
     * subscriber, rather than being silently swallowed.
     */
    private scheduleReplay(kind: 'notification' | 'tokenRefresh'): void {
        const buffer = kind === 'notification' ? this.notifications : this.tokens
        if (buffer.size === 0 || this.replayPending[kind]) {
            return
        }
        this.replayPending[kind] = true
        queueMicrotask(() => {
            this.replayPending[kind] = false
            if (this.disposed) {
                return
            }
            while (this.subscriberCount(kind) > 0) {
                const event = buffer.next()
                if (event === undefined) {
                    break
                }
                this.emit(event)
            }
        })
    }

    public onNotification(
        callback: (payload: INotificationPayload) => void,
        options: IListenOptions = {}
    ): IDisposable {
        if (typeof callback !== 'function') {
            throw new FCMError('invalid_argument', 'onNotification requires a callback function')
        }
        const listener: Listener<INotificationPayload> = { callback, once: options.once === true }
        this.notificationListeners.push(listener)
        this.scheduleReplay('notification')
        return {
            dispose: () => {
                const index = this.notificationListeners.indexOf(listener)
                if (index >= 0) {
                    this.notificationListeners.splice(index, 1)
                }
            }
        }
    }

    public onTokenRefresh(
        callback: (token: string) => void,
        options: IListenOptions = {}
    ): IDisposable {
        if (typeof callback !== 'function') {
            throw new FCMError('invalid_argument', 'onTokenRefresh requires a callback function')
        }
        const listener: Listener<string> = { callback, once: options.once === true }
        this.tokenListeners.push(listener)
        this.scheduleReplay('tokenRefresh')
        return {
            dispose: () => {
                const index = this.tokenListeners.indexOf(listener)
                if (index >= 0) {
                    this.tokenListeners.splice(index, 1)
                }
            }
        }
    }

    // ------------------------------------------------------------ native calls

    private callNative<T>(action: string, args: readonly unknown[] = []): Promise<T> {
        if (this.disposed) {
            return Promise.reject(
                new FCMError('not_initialized', 'This FCM instance has been disposed')
            )
        }
        const call = this.bridge.call<T>(action, args).then(
            (value) => value,
            (error: unknown) => {
                throw toFCMError(
                    'native_error',
                    error,
                    `FCM native call "${action}" failed`,
                    this.platformId
                )
            }
        )
        return this.withTimeout(call, `FCM native call "${action}"`)
    }

    /**
     * Bounds a native promise by `callTimeoutMs`. The resulting error keeps the
     * distinct `timeout` code: "the native side never answered" is a different
     * diagnosis from "the bridge is offline" and must not be flattened.
     */
    private withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
        if (this.options.callTimeoutMs <= 0) {
            return work
        }
        return new Promise<T>((resolve, reject) => {
            let settled = false
            const timer = setTimeout(() => {
                if (settled) {
                    return
                }
                settled = true
                reject(
                    new FCMError('timeout', `${label} timed out`, {
                        platform: this.platformId
                    })
                )
            }, this.options.callTimeoutMs)
            // The timer is deliberately *not* unref'd: an unref'd timer lets a
            // Node event loop drain and the process exit before the timeout
            // fires, which is exactly the "promise pending forever" failure this
            // guard exists to prevent. It is cleared on every settle below.
            work.then(
                (value) => {
                    if (settled) {
                        return
                    }
                    settled = true
                    clearTimeout(timer)
                    resolve(value)
                },
                (error: unknown) => {
                    if (settled) {
                        return
                    }
                    settled = true
                    clearTimeout(timer)
                    reject(error)
                }
            )
        })
    }

    /**
     * Waits for an asynchronous native event registration (Capacitor) to settle
     * before `ready`/`replayBufferedEvents` run. Bridges without asynchronous
     * registration (Cordova's keep-alive callback) have nothing to wait for.
     */
    private awaitEventRegistration(): Promise<void> {
        const registration = this.bridge.waitForEventRegistration?.()
        if (registration === undefined) {
            return Promise.resolve()
        }
        return this.withTimeout(registration, 'FCM native event listener registration')
    }

    /** Awaits initialization first, so callers never race the handshake. */
    private async invoke<T>(action: string, args: readonly unknown[] = []): Promise<T> {
        await this.initialize()
        return this.callNative<T>(action, args)
    }

    public getToken(): Promise<string> {
        return this.invoke<string>('getToken').then((token) => {
            if (typeof token !== 'string' || token.length === 0) {
                throw new FCMError('native_error', 'Native returned no registration token', {
                    platform: this.platformId
                })
            }
            return token
        })
    }

    /** Deletes the current FCM registration token for this app instance. */
    public deleteToken(): Promise<void> {
        return this.invoke<void>('deleteToken').then(() => undefined)
    }

    /**
     * Compatibility alias for `deleteToken()`. In 7.x this name implied the
     * whole Firebase installation was removed; it only ever revoked the
     * messaging token, and 8.x keeps exactly that behaviour.
     */
    public deleteInstanceId(): Promise<void> {
        return this.deleteToken()
    }

    public getAPNSToken(): Promise<string> {
        if (this.platformId !== 'ios') {
            return Promise.resolve('')
        }
        return this.invoke<string>('getAPNSToken').then((token) =>
            typeof token === 'string' ? token : ''
        )
    }

    public getInitialPushPayload(): Promise<INotificationPayload | null> {
        if (this.initialPayloadCache !== undefined) {
            return Promise.resolve(this.initialPayloadCache)
        }
        return this.invoke<unknown>('getInitialPushPayload').then((raw) => {
            if (!isRecord(raw)) {
                this.initialPayloadCache = null
                return null
            }
            const payload = sanitizeNotificationPayload(raw)
            // Cached: repeated reads return the same startup tap payload.
            this.initialPayloadCache = payload
            return payload
        })
    }

    public hasPermission(): Promise<boolean> {
        return this.invoke<unknown>('hasPermission').then(toBoolean)
    }

    public requestPushPermission(options: IRequestPushPermissionOptions = {}): Promise<boolean> {
        // 7.x `ios9Support` is accepted so old call sites compile, and ignored.
        const { ios9Support: _ignored, ...rest } = options
        return this.invoke<unknown>('requestPushPermission', [rest]).then(toBoolean)
    }

    public subscribeToTopic(topic: string): Promise<void> {
        const invalid = this.topicError(topic)
        if (invalid !== null) {
            return Promise.reject(invalid)
        }
        return this.invoke<void>('subscribeToTopic', [topic]).then(() => undefined)
    }

    public unsubscribeFromTopic(topic: string): Promise<void> {
        const invalid = this.topicError(topic)
        if (invalid !== null) {
            return Promise.reject(invalid)
        }
        return this.invoke<void>('unsubscribeFromTopic', [topic]).then(() => undefined)
    }

    public clearAllNotifications(): Promise<void> {
        return this.invoke<void>('clearAllNotifications').then(() => undefined)
    }

    /**
     * Turns Firebase's own auto-initialisation on or off. Explicit by design:
     * the host app owns the consent decision, the plugin never guesses it.
     */
    public setAutoInitEnabled(enabled: boolean): Promise<void> {
        if (typeof enabled !== 'boolean') {
            return Promise.reject(
                new FCMError('invalid_argument', 'setAutoInitEnabled requires a boolean', {
                    platform: this.platformId
                })
            )
        }
        return this.invoke<void>('setAutoInitEnabled', [enabled]).then(() => undefined)
    }

    public isAutoInitEnabled(): Promise<boolean> {
        return this.invoke<unknown>('isAutoInitEnabled').then(toBoolean)
    }

    public createNotificationChannel(channelConfig: IChannelConfiguration): Promise<void> {
        if (this.platformId !== 'android') {
            return Promise.resolve()
        }
        if (!isRecord(channelConfig)) {
            return Promise.reject(
                new FCMError(
                    'invalid_argument',
                    'createNotificationChannel requires a configuration object',
                    {
                        platform: this.platformId
                    }
                )
            )
        }
        if (typeof channelConfig.id !== 'string' || !CHANNEL_ID_PATTERN.test(channelConfig.id)) {
            return Promise.reject(
                new FCMError('invalid_argument', 'Notification channel id is invalid', {
                    platform: this.platformId
                })
            )
        }
        if (
            typeof channelConfig.name !== 'string' ||
            channelConfig.name.length === 0 ||
            channelConfig.name.length > 200
        ) {
            return Promise.reject(
                new FCMError('invalid_argument', 'Notification channel name is invalid', {
                    platform: this.platformId
                })
            )
        }
        return this.invoke<void>('createNotificationChannel', [channelConfig]).then(() => undefined)
    }

    /** Opt-in: by default foreground messages are event-only. */
    public configureForegroundPresentation(options: IForegroundPresentationOptions): Promise<void> {
        const payload: IForegroundPresentationOptions = {
            alert: options.alert === true,
            sound: options.sound === true,
            badge: options.badge === true
        }
        if (typeof options.channelId === 'string' && CHANNEL_ID_PATTERN.test(options.channelId)) {
            payload.channelId = options.channelId
        }
        return this.invoke<void>('setForegroundPresentation', [payload]).then(() => undefined)
    }

    /** Opt-in only: 7.x auto-subscribed to all/android/ios, 8.x never does. */
    public setAutoSubscribeTopics(topics: string[]): void {
        if (!Array.isArray(topics)) {
            throw new FCMError(
                'invalid_argument',
                'autoSubscribeTopics must be an array of strings'
            )
        }
        for (const topic of topics) {
            this.assertTopic(topic)
        }
        this.options.autoSubscribeTopics = [...topics]
    }

    private topicError(topic: string): FCMError | null {
        if (typeof topic !== 'string' || !TOPIC_PATTERN.test(topic)) {
            return new FCMError(
                'invalid_argument',
                `Invalid FCM topic name: ${JSON.stringify(topic)}`,
                {
                    platform: this.platformId
                }
            )
        }
        return null
    }

    private assertTopic(topic: string): void {
        const error = this.topicError(topic)
        if (error !== null) {
            throw error
        }
    }
}
