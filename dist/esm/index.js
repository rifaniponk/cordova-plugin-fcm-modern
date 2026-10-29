import { FCMCore } from './core/fcmCore.js';
import { RuntimeBridge } from './core/runtimeBridge.js';
import { CordovaBridge } from './bridges/cordovaBridge.js';
import { WebBridge } from './bridges/webBridge.js';
export * from './core/index.js';
export { FCMCore } from './core/fcmCore.js';
export { RuntimeBridge } from './core/runtimeBridge.js';
/**
 * Loads the bridge for the ambient runtime. Capacitor's module is imported
 * dynamically so a Cordova-only app never needs the optional `@capacitor/core`
 * peer, and a Capacitor app never needs Cordova.
 */
export const loadBridge = async (runtime) => {
    if (runtime === 'cordova') {
        return CordovaBridge.create();
    }
    if (runtime === 'capacitor') {
        const capacitor = await import('./capacitor/index.js');
        return capacitor.createCapacitorBridge();
    }
    return new WebBridge();
};
/**
 * Runtime-selecting factory. Use this when you want one import path for both
 * runtimes; pick `.../cordova` or `.../capacitor` when you want the explicit one.
 */
export const createFCM = (options = {}) => new FCMCore(new RuntimeBridge(loadBridge), options);
/** Shared instance for `import FCM from 'cordova-plugin-fcm-modern'`. */
export const FCM = createFCM();
export default FCM;
