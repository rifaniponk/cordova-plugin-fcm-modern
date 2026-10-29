import { FCMCore } from './core/fcmCore.js';
import type { IFCMOptions } from './core/types.js';
export * from './core/index.js';
export { FCMCore } from './core/fcmCore.js';
export { RuntimeBridge } from './core/runtimeBridge.js';
export { loadBridge } from './core/loadBridge.js';
/**
 * Runtime-selecting factory. Use this when you want one import path for both
 * runtimes; pick `.../cordova` or `.../capacitor` when you want the explicit one.
 */
export declare const createFCM: (options?: IFCMOptions) => FCMCore;
/**
 * Shared instance for `import FCM from 'cordova-plugin-fcm-modern'`. The Cordova
 * bundle and the npm CJS/ESM paths reuse it, so one app always has exactly one
 * event sink and one replay buffer (see src/core/instance.ts).
 */
export declare const FCM: FCMCore;
export default FCM;
