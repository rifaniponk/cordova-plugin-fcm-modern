import { FCMError, toFCMError } from '../core/errors.js';
/**
 * Talks to the registered Capacitor native plugin. Kept as a plain interface
 * dependency (not an `@capacitor/core` import) so the routing tests can drive it
 * with a fake, and so this file never forces the Capacitor peer onto Cordova apps.
 */
export class CapacitorBridge {
    runtime = 'capacitor';
    platformId;
    plugin;
    constructor(plugin, platformId) {
        this.plugin = plugin;
        this.platformId = platformId;
    }
    async dispatch(action, args) {
        const plugin = this.plugin;
        const unwrapValue = async (call) => {
            const result = (await call);
            return result?.value;
        };
        switch (action) {
            case 'ready':
                return plugin.ready?.();
            case 'replayBufferedEvents':
                return plugin.replayBufferedEvents?.();
            case 'setForegroundPresentation':
                return plugin.setForegroundPresentation?.(args[0]);
            case 'getToken':
                return unwrapValue(plugin.getToken?.());
            case 'deleteToken':
                return plugin.deleteToken?.();
            case 'getAPNSToken':
                return unwrapValue(plugin.getAPNSToken?.());
            case 'getInitialPushPayload': {
                const result = (await plugin.getInitialPushPayload?.());
                return result?.payload ?? null;
            }
            case 'hasPermission':
                return unwrapValue(plugin.hasPermission?.());
            case 'requestPushPermission':
                return unwrapValue(plugin.requestPushPermission?.(args[0]));
            case 'subscribeToTopic':
                return plugin.subscribeToTopic?.(String(args[0]));
            case 'unsubscribeFromTopic':
                return plugin.unsubscribeFromTopic?.(String(args[0]));
            case 'clearAllNotifications':
                return plugin.clearAllNotifications?.();
            case 'createNotificationChannel':
                return plugin.createNotificationChannel?.(args[0]);
            case 'stopJsEventBridge':
                return undefined;
            default:
                throw new FCMError('invalid_argument', `Unknown FCM action "${action}"`, {
                    platform: this.platformId
                });
        }
    }
    call(action, args = []) {
        return Promise.resolve()
            .then(() => this.dispatch(action, args))
            .then((value) => value)
            .catch((error) => {
            throw toFCMError('native_error', error, `Capacitor "${action}" failed`, this.platformId);
        });
    }
    addEventListener(listener, onTransportError) {
        const handles = [];
        let detached = false;
        const pending = [];
        pending.push(this.plugin
            .addListener('notification', (envelope) => {
            if (detached) {
                return;
            }
            listener({ kind: 'notification', payload: envelope });
        })
            .then((handle) => {
            handles.push(handle);
            if (detached) {
                void handle.remove().catch(() => undefined);
            }
            return handle;
        }));
        pending.push(this.plugin
            .addListener('tokenRefresh', (event) => {
            if (detached) {
                return;
            }
            listener({ kind: 'tokenRefresh', token: event?.token ?? '' });
        })
            .then((handle) => {
            handles.push(handle);
            if (detached) {
                void handle.remove().catch(() => undefined);
            }
            return handle;
        }));
        for (const handle of pending) {
            handle.catch((error) => {
                onTransportError?.(toFCMError('bridge_unavailable', error, 'Capacitor listener registration failed', this.platformId));
            });
        }
        return () => {
            detached = true;
            for (const handle of handles) {
                void handle.remove().catch(() => undefined);
            }
            for (const handle of pending) {
                void handle.then((resolved) => resolved.remove()).catch(() => undefined);
            }
        };
    }
}
