import { FCMError, isFCMError, toFCMError } from './errors.js';
import { EventBuffer } from './eventBuffer.js';
import { CountingEventTarget, NOTIFICATION_EVENT, TOKEN_REFRESH_EVENT } from './eventTarget.js';
import { sanitizeNotificationPayload } from './payload.js';
const DEFAULT_CALL_TIMEOUT_MS = 15_000;
const TOKEN_BUFFER_SIZE = 1;
/**
 * FCM topic names: the documented Firebase ASCII set, with no restriction on the
 * first character — a leading digit is valid ("9lives" is a legal topic name).
 */
const TOPIC_PATTERN = /^[a-zA-Z0-9\-_.~%]{1,900}$/;
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Native bridges disagree about booleans; Android has been seen sending 0/1. */
const toBoolean = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        const normalised = value.trim().toLowerCase();
        return normalised === 'true' || normalised === '1';
    }
    return false;
};
const notifySafely = (listener, value, onError) => {
    try {
        listener.callback(value);
        return true;
    }
    catch (error) {
        onError(error);
        return false;
    }
};
/**
 * Runtime-agnostic FCM facade. Everything that is not transport lives here, so
 * Cordova, Capacitor and the tests share one implementation of the semantics.
 */
export class FCMCore {
    eventTarget;
    platformId;
    notificationListeners = [];
    tokenListeners = [];
    notifications;
    tokens;
    options;
    initPromise = null;
    bridgeTeardown = null;
    initialPayloadCache;
    disposed = false;
    bridge;
    replayPending = {
        notification: false,
        tokenRefresh: false
    };
    constructor(bridge, options = {}) {
        this.bridge = bridge;
        this.options = {
            autoInitialize: options.autoInitialize ?? true,
            eventBufferSize: options.eventBufferSize ?? 20,
            dedupCacheSize: options.dedupCacheSize ?? 100,
            autoSubscribeTopics: options.autoSubscribeTopics ?? [],
            callTimeoutMs: options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
            foregroundPresentation: options.foregroundPresentation
        };
        this.eventTarget = new CountingEventTarget();
        // A listener attached directly on the event target is a subscriber too,
        // so it has to trigger replay exactly like onNotification() does.
        this.eventTarget.setOnSubscribe((type) => this.scheduleReplay(type === NOTIFICATION_EVENT ? 'notification' : 'tokenRefresh'));
        this.platformId = bridge.platformId;
        this.notifications = new EventBuffer(this.options.eventBufferSize, this.options.dedupCacheSize);
        this.tokens = new EventBuffer(TOKEN_BUFFER_SIZE, this.options.dedupCacheSize);
        if (this.options.autoInitialize) {
            // Never throws synchronously: failures surface through the API that
            // awaits them, so importing this module can't crash an app.
            void this.initialize().catch(() => undefined);
        }
    }
    get platform() {
        return this.bridge.platformId;
    }
    /** Starts (or reuses) the native handshake. Safe to call repeatedly. */
    initialize() {
        if (this.disposed) {
            return Promise.reject(new FCMError('not_initialized', 'This FCM instance has been disposed'));
        }
        if (this.initPromise !== null) {
            return this.initPromise;
        }
        const pending = this.runInitialization().catch((error) => {
            // Clear the memo so a later call can retry after a transient failure
            // instead of sticking every future call to one rejected promise.
            if (this.initPromise === pending) {
                this.initPromise = null;
            }
            throw error;
        });
        this.initPromise = pending;
        return pending;
    }
    ready() {
        return this.initialize();
    }
    async runInitialization() {
        if (this.bridge.runtime === 'web') {
            throw new FCMError('unsupported_platform', 'This build has no browser push implementation', {
                platform: this.bridge.platformId
            });
        }
        // Attach the event bridge *before* asking native to replay, otherwise a
        // cold-start burst is emitted into a world with no receiver.
        //
        // The event stream has its own failure channel: Cordova's
        // `startJsEventBridge` reports through the keep-alive error callback, which
        // never rejects the `ready` promise. A handshake that ignores it would
        // report success while the app silently had no sink, so the first transport
        // failure is captured and fails this initialization instead.
        let transportFailure;
        const takeTransportFailure = () => {
            const failure = transportFailure;
            transportFailure = undefined;
            return failure ?? null;
        };
        this.bridgeTeardown = this.bridge.addEventListener((event) => this.handleNativeEvent(event), (error) => {
            if (transportFailure === undefined) {
                transportFailure = error;
            }
        });
        try {
            // Capacitor's addListener is asynchronous: until that promise settles
            // the native side has nowhere to deliver, so replay must wait for it.
            await this.awaitEventRegistration();
            const registrationFailure = takeTransportFailure();
            if (registrationFailure !== null) {
                throw registrationFailure;
            }
            await this.callNative('ready');
            const readyFailure = takeTransportFailure();
            if (readyFailure !== null) {
                // `ready` answered, but the event stream died in the same
                // handshake: the plugin is not usable yet.
                throw readyFailure;
            }
        }
        catch (error) {
            this.teardownBridge();
            // A timeout is a distinct diagnosis ("the native side never answered")
            // and must not be flattened into "the bridge is offline".
            if (isFCMError(error) && error.code === 'timeout') {
                throw error;
            }
            const reason = toFCMError('bridge_unavailable', error, 'FCM native bridge is not available', this.platformId);
            throw new FCMError('bridge_unavailable', reason.message, {
                platform: this.platformId,
                cause: error
            });
        }
        if (this.options.foregroundPresentation) {
            await this.callNative('setForegroundPresentation', [
                this.options.foregroundPresentation
            ]);
        }
        for (const topic of this.options.autoSubscribeTopics) {
            // Deliberately *not* this.subscribeToTopic(): that awaits initialize(),
            // which is the promise currently running — it would deadlock.
            this.assertTopic(topic);
            await this.callNative('subscribeToTopic', [topic]);
        }
        await this.callNative('replayBufferedEvents');
    }
    teardownBridge() {
        if (this.bridgeTeardown !== null) {
            try {
                this.bridgeTeardown();
            }
            catch {
                // teardown must never break a call path
            }
            this.bridgeTeardown = null;
        }
    }
    /** Releases the bridge and all listeners. Idempotent. */
    dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.teardownBridge();
        this.notificationListeners.length = 0;
        this.tokenListeners.length = 0;
        this.notifications.drain();
        this.tokens.drain();
    }
    // ---------------------------------------------------------------- events
    subscriberCount(kind) {
        if (kind === 'notification') {
            return (this.notificationListeners.length +
                this.eventTarget.subscriberCount(NOTIFICATION_EVENT));
        }
        return this.tokenListeners.length + this.eventTarget.subscriberCount(TOKEN_REFRESH_EVENT);
    }
    handleNativeEvent(event) {
        if (this.disposed) {
            return;
        }
        let normalized;
        let buffer;
        if (event.kind === 'tokenRefresh') {
            const token = typeof event.token === 'string' ? event.token : '';
            if (token.length === 0) {
                return;
            }
            normalized = { kind: 'tokenRefresh', token };
            buffer = this.tokens;
        }
        else {
            const payload = sanitizeNotificationPayload(event.payload);
            if (payload === null) {
                return;
            }
            normalized = { kind: 'notification', payload };
            buffer = this.notifications;
        }
        const kind = normalized.kind === 'notification' ? 'notification' : 'tokenRefresh';
        // Dedup gates *every* accepted event (live or buffered), so a live
        // duplicate can never reach a listener twice.
        if (!buffer.tryAccept(normalized)) {
            return;
        }
        // Nobody listening yet, or a replay is already in flight: queue it so the
        // order stays chronological instead of the live event jumping the queue.
        if (this.subscriberCount(kind) === 0 || this.replayPending[kind]) {
            buffer.enqueue(normalized);
            return;
        }
        this.emit(normalized);
    }
    emit(event) {
        if (event.kind === 'notification') {
            this.dispatch(NOTIFICATION_EVENT, event.payload);
            this.deliverNotification(event);
            return;
        }
        this.dispatch(TOKEN_REFRESH_EVENT, event.token);
        this.deliverToken(event);
    }
    deliverNotification(event) {
        const listeners = [...this.notificationListeners];
        for (const listener of listeners) {
            const index = this.notificationListeners.indexOf(listener);
            if (listener.once && index >= 0) {
                this.notificationListeners.splice(index, 1);
            }
            notifySafely(listener, event.payload, () => undefined);
        }
    }
    deliverToken(event) {
        const listeners = [...this.tokenListeners];
        for (const listener of listeners) {
            const index = this.tokenListeners.indexOf(listener);
            if (listener.once && index >= 0) {
                this.tokenListeners.splice(index, 1);
            }
            notifySafely(listener, event.token, () => undefined);
        }
    }
    dispatch(name, detail) {
        try {
            this.eventTarget.dispatchEvent(new CustomEvent(name, { detail }));
        }
        catch {
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
    scheduleReplay(kind) {
        const buffer = kind === 'notification' ? this.notifications : this.tokens;
        if (buffer.size === 0 || this.replayPending[kind]) {
            return;
        }
        this.replayPending[kind] = true;
        queueMicrotask(() => {
            this.replayPending[kind] = false;
            if (this.disposed) {
                return;
            }
            while (this.subscriberCount(kind) > 0) {
                const event = buffer.next();
                if (event === undefined) {
                    break;
                }
                this.emit(event);
            }
        });
    }
    onNotification(callback, options = {}) {
        if (typeof callback !== 'function') {
            throw new FCMError('invalid_argument', 'onNotification requires a callback function');
        }
        const listener = { callback, once: options.once === true };
        this.notificationListeners.push(listener);
        this.scheduleReplay('notification');
        return {
            dispose: () => {
                const index = this.notificationListeners.indexOf(listener);
                if (index >= 0) {
                    this.notificationListeners.splice(index, 1);
                }
            }
        };
    }
    onTokenRefresh(callback, options = {}) {
        if (typeof callback !== 'function') {
            throw new FCMError('invalid_argument', 'onTokenRefresh requires a callback function');
        }
        const listener = { callback, once: options.once === true };
        this.tokenListeners.push(listener);
        this.scheduleReplay('tokenRefresh');
        return {
            dispose: () => {
                const index = this.tokenListeners.indexOf(listener);
                if (index >= 0) {
                    this.tokenListeners.splice(index, 1);
                }
            }
        };
    }
    // ------------------------------------------------------------ native calls
    callNative(action, args = []) {
        if (this.disposed) {
            return Promise.reject(new FCMError('not_initialized', 'This FCM instance has been disposed'));
        }
        const call = this.bridge.call(action, args).then((value) => value, (error) => {
            throw toFCMError('native_error', error, `FCM native call "${action}" failed`, this.platformId);
        });
        return this.withTimeout(call, `FCM native call "${action}"`);
    }
    /**
     * Bounds a native promise by `callTimeoutMs`. The resulting error keeps the
     * distinct `timeout` code: "the native side never answered" is a different
     * diagnosis from "the bridge is offline" and must not be flattened.
     */
    withTimeout(work, label) {
        if (this.options.callTimeoutMs <= 0) {
            return work;
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                reject(new FCMError('timeout', `${label} timed out`, {
                    platform: this.platformId
                }));
            }, this.options.callTimeoutMs);
            // The timer is deliberately *not* unref'd: an unref'd timer lets a
            // Node event loop drain and the process exit before the timeout
            // fires, which is exactly the "promise pending forever" failure this
            // guard exists to prevent. It is cleared on every settle below.
            work.then((value) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve(value);
            }, (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                reject(error);
            });
        });
    }
    /**
     * Waits for an asynchronous native event registration (Capacitor) to settle
     * before `ready`/`replayBufferedEvents` run. Bridges without asynchronous
     * registration (Cordova's keep-alive callback) have nothing to wait for.
     */
    awaitEventRegistration() {
        const registration = this.bridge.waitForEventRegistration?.();
        if (registration === undefined) {
            return Promise.resolve();
        }
        return this.withTimeout(registration, 'FCM native event listener registration');
    }
    /** Awaits initialization first, so callers never race the handshake. */
    async invoke(action, args = []) {
        await this.initialize();
        return this.callNative(action, args);
    }
    getToken() {
        return this.invoke('getToken').then((token) => {
            if (typeof token !== 'string' || token.length === 0) {
                throw new FCMError('native_error', 'Native returned no registration token', {
                    platform: this.platformId
                });
            }
            return token;
        });
    }
    /** Deletes the current FCM registration token for this app instance. */
    deleteToken() {
        return this.invoke('deleteToken').then(() => undefined);
    }
    /**
     * Compatibility alias for `deleteToken()`. In 7.x this name implied the
     * whole Firebase installation was removed; it only ever revoked the
     * messaging token, and 8.x keeps exactly that behaviour.
     */
    deleteInstanceId() {
        return this.deleteToken();
    }
    getAPNSToken() {
        if (this.platformId !== 'ios') {
            return Promise.resolve('');
        }
        return this.invoke('getAPNSToken').then((token) => typeof token === 'string' ? token : '');
    }
    getInitialPushPayload() {
        if (this.initialPayloadCache !== undefined) {
            return Promise.resolve(this.initialPayloadCache);
        }
        return this.invoke('getInitialPushPayload').then((raw) => {
            if (!isRecord(raw)) {
                this.initialPayloadCache = null;
                return null;
            }
            const payload = sanitizeNotificationPayload(raw);
            // Cached: repeated reads return the same startup tap payload.
            this.initialPayloadCache = payload;
            return payload;
        });
    }
    hasPermission() {
        return this.invoke('hasPermission').then(toBoolean);
    }
    requestPushPermission(options = {}) {
        // 7.x `ios9Support` is accepted so old call sites compile, and ignored.
        const { ios9Support: _ignored, ...rest } = options;
        return this.invoke('requestPushPermission', [rest]).then(toBoolean);
    }
    subscribeToTopic(topic) {
        const invalid = this.topicError(topic);
        if (invalid !== null) {
            return Promise.reject(invalid);
        }
        return this.invoke('subscribeToTopic', [topic]).then(() => undefined);
    }
    unsubscribeFromTopic(topic) {
        const invalid = this.topicError(topic);
        if (invalid !== null) {
            return Promise.reject(invalid);
        }
        return this.invoke('unsubscribeFromTopic', [topic]).then(() => undefined);
    }
    clearAllNotifications() {
        return this.invoke('clearAllNotifications').then(() => undefined);
    }
    /**
     * Turns Firebase's own auto-initialisation on or off. Explicit by design:
     * the host app owns the consent decision, the plugin never guesses it.
     */
    setAutoInitEnabled(enabled) {
        if (typeof enabled !== 'boolean') {
            return Promise.reject(new FCMError('invalid_argument', 'setAutoInitEnabled requires a boolean', {
                platform: this.platformId
            }));
        }
        return this.invoke('setAutoInitEnabled', [enabled]).then(() => undefined);
    }
    isAutoInitEnabled() {
        return this.invoke('isAutoInitEnabled').then(toBoolean);
    }
    createNotificationChannel(channelConfig) {
        if (this.platformId !== 'android') {
            return Promise.resolve();
        }
        if (!isRecord(channelConfig)) {
            return Promise.reject(new FCMError('invalid_argument', 'createNotificationChannel requires a configuration object', {
                platform: this.platformId
            }));
        }
        if (typeof channelConfig.id !== 'string' || !CHANNEL_ID_PATTERN.test(channelConfig.id)) {
            return Promise.reject(new FCMError('invalid_argument', 'Notification channel id is invalid', {
                platform: this.platformId
            }));
        }
        if (typeof channelConfig.name !== 'string' ||
            channelConfig.name.length === 0 ||
            channelConfig.name.length > 200) {
            return Promise.reject(new FCMError('invalid_argument', 'Notification channel name is invalid', {
                platform: this.platformId
            }));
        }
        return this.invoke('createNotificationChannel', [channelConfig]).then(() => undefined);
    }
    /** Opt-in: by default foreground messages are event-only. */
    configureForegroundPresentation(options) {
        const payload = {
            alert: options.alert === true,
            sound: options.sound === true,
            badge: options.badge === true
        };
        if (typeof options.channelId === 'string' && CHANNEL_ID_PATTERN.test(options.channelId)) {
            payload.channelId = options.channelId;
        }
        return this.invoke('setForegroundPresentation', [payload]).then(() => undefined);
    }
    /** Opt-in only: 7.x auto-subscribed to all/android/ios, 8.x never does. */
    setAutoSubscribeTopics(topics) {
        if (!Array.isArray(topics)) {
            throw new FCMError('invalid_argument', 'autoSubscribeTopics must be an array of strings');
        }
        for (const topic of topics) {
            this.assertTopic(topic);
        }
        this.options.autoSubscribeTopics = [...topics];
    }
    topicError(topic) {
        if (typeof topic !== 'string' || !TOPIC_PATTERN.test(topic)) {
            return new FCMError('invalid_argument', `Invalid FCM topic name: ${JSON.stringify(topic)}`, {
                platform: this.platformId
            });
        }
        return null;
    }
    assertTopic(topic) {
        const error = this.topicError(topic);
        if (error !== null) {
            throw error;
        }
    }
}
