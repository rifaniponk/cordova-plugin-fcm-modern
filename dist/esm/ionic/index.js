import { FCMIonicBase } from './shared.js';
/**
 * Legacy Ionic (v3-era) entry: `import { FCMPluginOnIonic, FCM } from 'cordova-plugin-fcm-modern/ionic'`.
 *
 * 7.x exported both the plugin *instance* and a class, so both stay — but `FCM`
 * here is a wrapper instance, not the root core re-export. 7.x bound
 * `onNotification`/`onTokenRefresh` to Observables, and the root core binds them to
 * disposable handles; one object cannot carry both signatures, so re-exporting the
 * core from this subpath would silently break every 7.x Ionic stream.
 *
 * Identity is preserved where it matters: `wrapper.core` *is* the root instance,
 * the same object `window.FCM`, `/ionic/ngx` and `/ionic/v4` use — three wrappers,
 * one native sink (docs/BRIDGE-CONTRACT.md).
 */
export * from '../index.js';
export { FCMIonicBase, ionicFCM } from './shared.js';
/**
 * `export *` already re-exported the 7.x class alias (`FCMPlugin` → `FCMCore`)
 * from the core entry; it is kept as-is so `new FCMPlugin()` / `instanceof` still
 * work here. Only the *instance* export below differs from the root entry, and it
 * shadows nothing.
 */
export class FCMPluginOnIonic extends FCMIonicBase {
    constructor(options = {}) {
        super(options);
    }
}
/** The 7.x Ionic plugin instance: an Observable-shaped facade over the shared core. */
export const FCM = new FCMPluginOnIonic();
