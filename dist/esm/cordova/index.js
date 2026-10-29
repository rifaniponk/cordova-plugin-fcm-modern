import { FCMCore } from '../core/fcmCore.js';
import { sharedFCM } from '../core/instance.js';
import { CordovaBridge, getCordovaHost } from '../bridges/cordovaBridge.js';
export { CordovaBridge, getCordovaHost } from '../bridges/cordovaBridge.js';
export { FCMCore } from '../core/fcmCore.js';
export * from '../core/index.js';
/**
 * Explicit Cordova entry: `import { FCM } from 'cordova-plugin-fcm-modern/cordova'`.
 * Cordova's own `<clobbers target="FCM" />` binding is produced from this module,
 * so `window.FCM` and the imported instance are the same object.
 */
export const createFCM = (options = {}) => new FCMCore(CordovaBridge.create(), options);
/**
 * The shared instance: if the app already imported the package root (or another
 * entrypoint), this is that same FCMCore, not a second one with a second native
 * event sink.
 */
export const FCM = sharedFCM(() => new FCMCore(CordovaBridge.create()));
// Only assign a global when one exists: importing in Node/SSR must stay safe.
const host = globalThis;
if (typeof host.window === 'object' && host.window !== null && getCordovaHost() !== null) {
    host.window.FCM = FCM;
}
export default FCM;
