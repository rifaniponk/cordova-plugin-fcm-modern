import { FCMCore } from '../core/fcmCore.js';
import type { IFCMOptions, IPluginBridge } from '../core/types.js';
import type { FCMNativeContract } from './contract.js';
export type { FCMNativeContract, FCMListenerHandle } from './contract.js';
export { CapacitorBridge } from '../bridges/capacitorBridge.js';
/**
 * Capacitor's `registerPlugin` surface. Declared structurally so this module
 * type-checks without the optional Capacitor peer installed, and so the tests can
 * register a fake native plugin.
 */
type RegisterPlugin = <T>(pluginId: string, implementations?: {
    web?: () => Promise<T> | T;
}) => T;
type LoadRegisterPlugin = () => Promise<{
    registerPlugin: RegisterPlugin;
}>;
/** The registered native plugin, or the web stand-in when running in a browser. */
export declare const getNativePlugin: (loader?: LoadRegisterPlugin) => Promise<FCMNativeContract>;
export declare const createCapacitorBridge: () => Promise<IPluginBridge>;
/**
 * Capacitor-first entry: `import { FCM } from 'cordova-plugin-fcm-modern/capacitor'`.
 * The native plugin is registered lazily, so importing this module in a browser
 * or during SSR is safe.
 */
export declare const createFCM: (options?: IFCMOptions) => FCMCore;
export { FCMCore };
export type { IFCMOptions };
/**
 * Instance created on first import. Auto-initialisation is on by default, so an
 * app that imports this subpath in `index.html`/`main.tsx` receives cold-start
 * events as soon as the native replay runs.
 */
export declare const FCM: FCMCore;
