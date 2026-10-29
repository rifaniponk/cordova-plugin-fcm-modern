import { FCMCore } from './core/fcmCore.js';
import type { IPluginBridge, RuntimeId } from './core/types.js';
import type { IFCMOptions } from './core/types.js';
export * from './core/index.js';
export { FCMCore } from './core/fcmCore.js';
export { RuntimeBridge } from './core/runtimeBridge.js';
/**
 * Loads the bridge for the ambient runtime. Capacitor's module is imported
 * dynamically so a Cordova-only app never needs the optional `@capacitor/core`
 * peer, and a Capacitor app never needs Cordova.
 */
export declare const loadBridge: (runtime: RuntimeId) => Promise<IPluginBridge>;
/**
 * Runtime-selecting factory. Use this when you want one import path for both
 * runtimes; pick `.../cordova` or `.../capacitor` when you want the explicit one.
 */
export declare const createFCM: (options?: IFCMOptions) => FCMCore;
/** Shared instance for `import FCM from 'cordova-plugin-fcm-modern'`. */
export declare const FCM: FCMCore;
export default FCM;
