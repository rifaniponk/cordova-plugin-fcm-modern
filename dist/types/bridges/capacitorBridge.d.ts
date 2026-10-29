import { FCMError } from '../core/errors.js';
import type { IPluginBridge, NativeEvent, PlatformId } from '../core/types.js';
import type { FCMNativeContract } from '../capacitor/contract.js';
type CallArgs = readonly unknown[];
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
export declare class CapacitorBridge implements IPluginBridge {
    readonly runtime: "capacitor";
    readonly platformId: PlatformId;
    private readonly plugin;
    private registration;
    constructor(plugin: FCMNativeContract, platformId: PlatformId);
    /** Resolves once the asynchronous `addListener` registrations have settled. */
    waitForEventRegistration(): Promise<void>;
    /**
     * Looks a native method up by name and rejects when it is absent, instead of
     * silently resolving `undefined` the way `plugin.getToken?.()` would.
     */
    private method;
    private dispatch;
    call<T = unknown>(action: string, args?: CallArgs): Promise<T>;
    addEventListener(listener: (event: NativeEvent) => void, onTransportError?: (error: FCMError) => void): () => void;
}
export {};
