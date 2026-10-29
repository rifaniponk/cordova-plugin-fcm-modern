import { FCMError, toFCMError } from '../core/errors.js'
import type { IPluginBridge, NativeEvent, PlatformId } from '../core/types.js'
import type { FCMListenerHandle, FCMNativeContract } from '../capacitor/contract.js'

type CallArgs = readonly unknown[]

/**
 * Talks to the registered Capacitor native plugin. Kept as a plain interface
 * dependency (not an `@capacitor/core` import) so the routing tests can drive it
 * with a fake, and so this file never forces the Capacitor peer onto Cordova apps.
 *
 * Capacitor's wire shape differs from Cordova's on purpose: inputs are objects
 * (never bare strings) and values arrive wrapped in `{ value }` / `{ payload }`.
 * A method the native plugin failed to implement rejects — an optional chain
 * would resolve `undefined` and an app would believe a topic subscription or a
 * token deletion had succeeded.
 */
export class CapacitorBridge implements IPluginBridge {
    public readonly runtime = 'capacitor' as const
    public readonly platformId: PlatformId
    private readonly plugin: FCMNativeContract
    private registration: Promise<void> | null = null

    constructor(plugin: FCMNativeContract, platformId: PlatformId) {
        this.plugin = plugin
        this.platformId = platformId
    }

    /** Resolves once the asynchronous `addListener` registrations have settled. */
    public waitForEventRegistration(): Promise<void> {
        return this.registration ?? Promise.resolve()
    }

    /**
     * Looks a native method up by name and rejects when it is absent, instead of
     * silently resolving `undefined` the way `plugin.getToken?.()` would.
     */
    private method(name: string): (...args: unknown[]) => unknown {
        const candidate = (this.plugin as unknown as Record<string, unknown>)[name]
        if (typeof candidate !== 'function') {
            throw new FCMError(
                'bridge_unavailable',
                `Capacitor plugin "FCMPlugin" does not implement "${name}"`,
                { platform: this.platformId }
            )
        }
        return candidate.bind(this.plugin) as (...args: unknown[]) => unknown
    }

    private async dispatch(action: string, args: CallArgs): Promise<unknown> {
        const unwrapValue = async (call: unknown): Promise<string | boolean | undefined> => {
            const result = (await call) as { value?: string | boolean } | undefined
            return result?.value
        }
        switch (action) {
            case 'ready':
                return this.method('ready')()
            case 'replayBufferedEvents':
                return this.method('replayBufferedEvents')()
            case 'setForegroundPresentation':
                return this.method('setForegroundPresentation')(args[0])
            case 'getToken':
                return unwrapValue(this.method('getToken')())
            case 'deleteToken':
                return this.method('deleteToken')()
            case 'getAPNSToken':
                return unwrapValue(this.method('getAPNSToken')())
            case 'getInitialPushPayload': {
                const result = (await this.method('getInitialPushPayload')()) as
                    { payload?: Record<string, unknown> | null } | undefined
                return result?.payload ?? null
            }
            case 'hasPermission':
                return unwrapValue(this.method('hasPermission')())
            case 'requestPushPermission':
                return unwrapValue(this.method('requestPushPermission')(args[0]))
            case 'subscribeToTopic':
                return this.method('subscribeToTopic')({ topic: String(args[0]) })
            case 'unsubscribeFromTopic':
                return this.method('unsubscribeFromTopic')({ topic: String(args[0]) })
            case 'clearAllNotifications':
                return this.method('clearAllNotifications')()
            case 'createNotificationChannel':
                return this.method('createNotificationChannel')(args[0])
            case 'setAutoInitEnabled':
                return this.method('setAutoInitEnabled')({ enabled: args[0] === true })
            case 'isAutoInitEnabled':
                return unwrapValue(this.method('isAutoInitEnabled')())
            case 'stopJsEventBridge':
                // Capacitor teardown is the listener handle, not a native action.
                return undefined
            default:
                throw new FCMError('invalid_argument', `Unknown FCM action "${action}"`, {
                    platform: this.platformId
                })
        }
    }

    public call<T = unknown>(action: string, args: CallArgs = []): Promise<T> {
        return Promise.resolve()
            .then(() => this.dispatch(action, args))
            .then((value) => value as T)
            .catch((error: unknown) => {
                throw toFCMError(
                    'native_error',
                    error,
                    `Capacitor "${action}" failed`,
                    this.platformId
                )
            })
    }

    public addEventListener(
        listener: (event: NativeEvent) => void,
        onTransportError?: (error: FCMError) => void
    ): () => void {
        let detached = false
        const live: FCMListenerHandle[] = []
        const removed = new Set<FCMListenerHandle>()
        const removeOnce = (handle: FCMListenerHandle): void => {
            if (removed.has(handle)) {
                return
            }
            removed.add(handle)
            void handle.remove().catch(() => undefined)
        }
        const adopt = (handle: FCMListenerHandle): FCMListenerHandle => {
            if (detached) {
                // Disposal raced the registration: drop the handle as soon as lands.
                removeOnce(handle)
            } else {
                live.push(handle)
            }
            return handle
        }

        const notification: Promise<FCMListenerHandle> = this.plugin
            .addListener('notification', (envelope) => {
                if (detached) {
                    return
                }
                listener({ kind: 'notification', payload: envelope as never })
            })
            .then(adopt)
        const tokenRefresh: Promise<FCMListenerHandle> = this.plugin
            .addListener('tokenRefresh', (event) => {
                if (detached) {
                    return
                }
                listener({ kind: 'tokenRefresh', token: event?.token ?? '' })
            })
            .then(adopt)
        const pending: Array<Promise<FCMListenerHandle>> = [notification, tokenRefresh]

        // The core awaits this before `ready`/replay so a cold-start burst can
        // never be emitted while registration is still in flight. A consumer that
        // never awaits must not turn a rejected registration into an unhandled
        // rejection, so the failure is reported separately.
        const settled = Promise.all(pending).then(() => undefined)
        settled.catch((error: unknown) => {
            onTransportError?.(
                toFCMError(
                    'bridge_unavailable',
                    error,
                    'Capacitor listener registration failed',
                    this.platformId
                )
            )
        })
        this.registration = settled

        return () => {
            detached = true
            for (const handle of live) {
                removeOnce(handle)
            }
            // Handles whose registration is still in flight are removed when it
            // lands; `removeOnce` guarantees that happens exactly once, whether
            // the promise settled before or after this teardown ran.
            for (const handle of pending) {
                void handle.then((resolved) => removeOnce(resolved)).catch(() => undefined)
            }
        }
    }
}
