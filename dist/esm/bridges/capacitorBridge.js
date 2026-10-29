import { FCMError, toFCMError } from '../core/errors.js';
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
export class CapacitorBridge {
    runtime = 'capacitor';
    platformId;
    plugin;
    registration = null;
    constructor(plugin, platformId) {
        this.plugin = plugin;
        this.platformId = platformId;
    }
    /** Resolves once the asynchronous `addListener` registrations have settled. */
    waitForEventRegistration() {
        return this.registration ?? Promise.resolve();
    }
    /**
     * Looks a native method up by name and rejects when it is absent, instead of
     * silently resolving `undefined` the way `plugin.getToken?.()` would.
     */
    method(name) {
        const candidate = this.plugin[name];
        if (typeof candidate !== 'function') {
            throw new FCMError('bridge_unavailable', `Capacitor plugin "FCMPlugin" does not implement "${name}"`, { platform: this.platformId });
        }
        return candidate.bind(this.plugin);
    }
    async dispatch(action, args) {
        const unwrapValue = async (call) => {
            const result = (await call);
            return result?.value;
        };
        switch (action) {
            case 'ready':
                return this.method('ready')();
            case 'replayBufferedEvents':
                return this.method('replayBufferedEvents')();
            case 'setForegroundPresentation':
                return this.method('setForegroundPresentation')(args[0]);
            case 'getToken':
                return unwrapValue(this.method('getToken')());
            case 'deleteToken':
                return this.method('deleteToken')();
            case 'getAPNSToken':
                return unwrapValue(this.method('getAPNSToken')());
            case 'getInitialPushPayload': {
                const result = (await this.method('getInitialPushPayload')());
                return result?.payload ?? null;
            }
            case 'hasPermission':
                return unwrapValue(this.method('hasPermission')());
            case 'requestPushPermission':
                return unwrapValue(this.method('requestPushPermission')(args[0]));
            case 'subscribeToTopic':
                return this.method('subscribeToTopic')({ topic: String(args[0]) });
            case 'unsubscribeFromTopic':
                return this.method('unsubscribeFromTopic')({ topic: String(args[0]) });
            case 'clearAllNotifications':
                return this.method('clearAllNotifications')();
            case 'createNotificationChannel':
                return this.method('createNotificationChannel')(args[0]);
            case 'setAutoInitEnabled':
                return this.method('setAutoInitEnabled')({ enabled: args[0] === true });
            case 'isAutoInitEnabled':
                return unwrapValue(this.method('isAutoInitEnabled')());
            case 'stopJsEventBridge':
                // Capacitor teardown is the listener handle, not a native action.
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
        let detached = false;
        const live = [];
        const removed = new Set();
        const removeOnce = (handle) => {
            if (removed.has(handle)) {
                return;
            }
            removed.add(handle);
            void handle.remove().catch(() => undefined);
        };
        const adopt = (handle) => {
            if (detached) {
                // Disposal raced the registration: drop the handle as soon as lands.
                removeOnce(handle);
            }
            else {
                live.push(handle);
            }
            return handle;
        };
        const notification = this.plugin
            .addListener('notification', (envelope) => {
            if (detached) {
                return;
            }
            listener({ kind: 'notification', payload: envelope });
        })
            .then(adopt);
        const tokenRefresh = this.plugin
            .addListener('tokenRefresh', (event) => {
            if (detached) {
                return;
            }
            listener({ kind: 'tokenRefresh', token: event?.token ?? '' });
        })
            .then(adopt);
        const pending = [notification, tokenRefresh];
        // The core awaits this before `ready`/replay so a cold-start burst can
        // never be emitted while registration is still in flight. A consumer that
        // never awaits must not turn a rejected registration into an unhandled
        // rejection, so the failure is reported separately.
        const settled = Promise.all(pending).then(() => undefined);
        settled.catch((error) => {
            onTransportError?.(toFCMError('bridge_unavailable', error, 'Capacitor listener registration failed', this.platformId));
        });
        this.registration = settled;
        return () => {
            detached = true;
            for (const handle of live) {
                removeOnce(handle);
            }
            // Handles whose registration is still in flight are removed when it
            // lands; `removeOnce` guarantees that happens exactly once, whether
            // the promise settled before or after this teardown ran.
            for (const handle of pending) {
                void handle.then((resolved) => removeOnce(resolved)).catch(() => undefined);
            }
        };
    }
}
