import { FCMCore } from '../core/fcmCore.js';
import type { IFCMOptions } from '../core/types.js';
export { CordovaBridge, getCordovaHost } from '../bridges/cordovaBridge.js';
export { FCMCore } from '../core/fcmCore.js';
export * from '../core/index.js';
/**
 * Explicit Cordova entry: `import { FCM } from 'cordova-plugin-fcm-modern/cordova'`.
 * Cordova's own `<clobbers target="FCM" />` binding is produced from this module,
 * so `window.FCM` and the imported instance are the same object.
 */
export declare const createFCM: (options?: IFCMOptions) => FCMCore;
export declare const FCM: FCMCore;
export default FCM;
