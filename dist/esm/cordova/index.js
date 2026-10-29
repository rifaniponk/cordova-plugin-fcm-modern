import { FCMCore } from '../core/fcmCore.js';
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
export const FCM = createFCM();
// Only assign a global when one exists: importing in Node/SSR must stay safe.
const host = globalThis;
if (typeof host.window === 'object' && host.window !== null && getCordovaHost() !== null) {
    host.window.FCM = FCM;
}
export default FCM;
