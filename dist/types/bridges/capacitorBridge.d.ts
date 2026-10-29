import { FCMError } from '../core/errors.js';
import type { IPluginBridge, NativeEvent, PlatformId } from '../core/types.js';
import type { FCMNativeContract } from '../capacitor/contract.js';
type CallArgs = readonly unknown[];
/**
 * Talks to the registered Capacitor native plugin. Kept as a plain interface
 * dependency (not an `@capacitor/core` import) so the routing tests can drive it
 * with a fake, and so this file never forces the Capacitor peer onto Cordova apps.
 */
export declare class CapacitorBridge implements IPluginBridge {
    readonly runtime: "capacitor";
    readonly platformId: PlatformId;
    private readonly plugin;
    constructor(plugin: FCMNativeContract, platformId: PlatformId);
    private dispatch;
    call<T = unknown>(action: string, args?: CallArgs): Promise<T>;
    addEventListener(listener: (event: NativeEvent) => void, onTransportError?: (error: FCMError) => void): () => void;
}
export {};
