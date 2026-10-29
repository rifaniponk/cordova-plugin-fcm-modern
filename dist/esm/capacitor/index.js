import { FCMCore } from '../core/fcmCore.js';
import { RuntimeBridge } from '../core/runtimeBridge.js';
import { sharedFCM } from '../core/instance.js';
import { CapacitorBridge } from '../bridges/capacitorBridge.js';
import { WebBridge } from '../bridges/webBridge.js';
export { CapacitorBridge } from '../bridges/capacitorBridge.js';
// Same public core surface the root and Cordova entries expose, so picking a
// runtime subpath never costs an app part of the public API.
export * from '../core/index.js';
/** Web stand-in required by Capacitor's plugin registry: fails, never hangs. */
class WebFCMPlugin {
    unsupported(method) {
        return Promise.reject(new Error(`FCMPlugin.${method} is not available on web: cordova-plugin-fcm-modern implements Android and iOS push only.`));
    }
    ready() {
        return this.unsupported('ready');
    }
    replayBufferedEvents() {
        return this.unsupported('replayBufferedEvents');
    }
    setForegroundPresentation() {
        return this.unsupported('setForegroundPresentation');
    }
    getToken() {
        return this.unsupported('getToken');
    }
    deleteToken() {
        return this.unsupported('deleteToken');
    }
    getAPNSToken() {
        return this.unsupported('getAPNSToken');
    }
    getInitialPushPayload() {
        return this.unsupported('getInitialPushPayload');
    }
    hasPermission() {
        return this.unsupported('hasPermission');
    }
    requestPushPermission() {
        return this.unsupported('requestPushPermission');
    }
    subscribeToTopic() {
        return this.unsupported('subscribeToTopic');
    }
    unsubscribeFromTopic() {
        return this.unsupported('unsubscribeFromTopic');
    }
    clearAllNotifications() {
        return this.unsupported('clearAllNotifications');
    }
    createNotificationChannel() {
        return this.unsupported('createNotificationChannel');
    }
    setAutoInitEnabled() {
        return this.unsupported('setAutoInitEnabled');
    }
    isAutoInitEnabled() {
        return this.unsupported('isAutoInitEnabled');
    }
    addListener() {
        return Promise.resolve({ remove: () => Promise.resolve() });
    }
}
let registered = null;
/** The registered native plugin, or the web stand-in when running in a browser. */
export const getNativePlugin = async (loader = () => import('@capacitor/core').then((core) => ({
    registerPlugin: core.registerPlugin
}))) => {
    if (registered !== null) {
        return registered;
    }
    const { registerPlugin } = await loader();
    registered = registerPlugin('FCMPlugin', {
        web: () => new WebFCMPlugin()
    });
    return registered;
};
export const createCapacitorBridge = async () => {
    const plugin = await getNativePlugin();
    const platform = globalThis.Capacitor?.getPlatform?.();
    const platformId = platform === 'android' || platform === 'ios' ? platform : 'unknown';
    if (platformId === 'unknown' && platform === 'web') {
        return new WebBridge();
    }
    return new CapacitorBridge(plugin, platformId);
};
const capacitorPlatformId = () => {
    const platform = globalThis.Capacitor?.getPlatform?.();
    return platform === 'android' || platform === 'ios' || platform === 'web' ? platform : 'unknown';
};
/**
 * Capacitor-first entry: `import { FCM } from 'cordova-plugin-fcm-modern/capacitor'`.
 * The native plugin is registered lazily, so importing this module in a browser
 * or during SSR is safe.
 */
export const createFCM = (options = {}) => {
    const platformId = capacitorPlatformId();
    const bridge = new RuntimeBridge(async () => (platformId === 'web' ? new WebBridge() : createCapacitorBridge()), { runtime: 'capacitor', platformId });
    return new FCMCore(bridge, options);
};
export { FCMCore };
/**
 * Instance created on first import. Auto-initialisation is on by default, so an
 * app that imports this subpath in `index.html`/`main.tsx` receives cold-start
 * events as soon as the native replay runs. It is the same shared instance the
 * package root hands out, so a Capacitor app never ends up with two event sinks.
 */
export const FCM = sharedFCM(() => createFCM());
