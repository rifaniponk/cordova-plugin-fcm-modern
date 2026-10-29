import { FCMError, toFCMError } from '../core/errors.js'
import type { IPluginBridge, NativeEvent, PlatformId } from '../core/types.js'
import type { FCMListenerHandle, FCMNativeContract } from '../capacitor/contract.js'

type CallArgs = readonly unknown[]

/**
 * Talks to the registered Capacitor native plugin. Kept as a plain interface
 * dependency (not an `@capacitor/core` import) so the routing tests can drive it
 * with a fake, and so this file never forces the Capacitor peer onto Cordova apps.
 */
export class CapacitorBridge implements IPluginBridge {
    public readonly runtime = 'capacitor' as const
    public readonly platformId: PlatformId
    private readonly plugin: FCMNativeContract

    constructor(plugin: FCMNativeContract, platformId: PlatformId) {
        this.plugin = plugin
        this.platformId = platformId
    }

    private async dispatch(action: string, args: CallArgs): Promise<unknown> {
        const plugin = this.plugin as unknown as Record<
            string,
            ((...a: unknown[]) => Promise<unknown>) | undefined
        >
        const unwrapValue = async (
            call: Promise<unknown> | undefined
        ): Promise<string | boolean | undefined> => {
            const result = (await call) as { value?: string | boolean } | undefined
            return result?.value
        }
        switch (action) {
            case 'ready':
                return plugin.ready?.()
            case 'replayBufferedEvents':
                return plugin.replayBufferedEvents?.()
            case 'setForegroundPresentation':
                return plugin.setForegroundPresentation?.(args[0] as never)
            case 'getToken':
                return unwrapValue(plugin.getToken?.())
            case 'deleteToken':
                return plugin.deleteToken?.()
            case 'getAPNSToken':
                return unwrapValue(plugin.getAPNSToken?.())
            case 'getInitialPushPayload': {
                const result = (await plugin.getInitialPushPayload?.()) as
                    { payload?: Record<string, unknown> | null } | undefined
                return result?.payload ?? null
            }
            case 'hasPermission':
                return unwrapValue(plugin.hasPermission?.())
            case 'requestPushPermission':
                return unwrapValue(plugin.requestPushPermission?.(args[0] as never))
            case 'subscribeToTopic':
                return plugin.subscribeToTopic?.(String(args[0]))
            case 'unsubscribeFromTopic':
                return plugin.unsubscribeFromTopic?.(String(args[0]))
            case 'clearAllNotifications':
                return plugin.clearAllNotifications?.()
            case 'createNotificationChannel':
                return plugin.createNotificationChannel?.(args[0] as never)
            case 'stopJsEventBridge':
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
        const handles: FCMListenerHandle[] = []
        let detached = false
        const pending: Array<Promise<FCMListenerHandle>> = []

        pending.push(
            this.plugin
                .addListener('notification', (envelope) => {
                    if (detached) {
                        return
                    }
                    listener({ kind: 'notification', payload: envelope as never })
                })
                .then((handle) => {
                    handles.push(handle)
                    if (detached) {
                        void handle.remove().catch(() => undefined)
                    }
                    return handle
                })
        )
        pending.push(
            this.plugin
                .addListener('tokenRefresh', (event) => {
                    if (detached) {
                        return
                    }
                    listener({ kind: 'tokenRefresh', token: event?.token ?? '' })
                })
                .then((handle) => {
                    handles.push(handle)
                    if (detached) {
                        void handle.remove().catch(() => undefined)
                    }
                    return handle
                })
        )
        for (const handle of pending) {
            handle.catch((error: unknown) => {
                onTransportError?.(
                    toFCMError(
                        'bridge_unavailable',
                        error,
                        'Capacitor listener registration failed',
                        this.platformId
                    )
                )
            })
        }

        return () => {
            detached = true
            for (const handle of handles) {
                void handle.remove().catch(() => undefined)
            }
            for (const handle of pending) {
                void handle.then((resolved) => resolved.remove()).catch(() => undefined)
            }
        }
    }
}
