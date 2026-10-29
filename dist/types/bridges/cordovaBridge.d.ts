import { FCMError } from '../core/errors.js';
import type { IPluginBridge, NativeEvent, PlatformId } from '../core/types.js';
export interface CordovaExecHost {
    platformId?: string;
    exec: (success: (...args: unknown[]) => void, fail: (...args: unknown[]) => void, service: string, action: string, args: unknown[]) => void;
}
export declare const BRIDGE_SERVICE = "FCMPlugin";
/** Reads `window.cordova` lazily so importing this module never needs a DOM. */
export declare const getCordovaHost: () => CordovaExecHost | null;
/**
 * Cordova transport: `cordova.exec` promises + one long-lived keep-alive callback
 * for native-originated events.
 */
export declare class CordovaBridge implements IPluginBridge {
    readonly runtime: "cordova";
    readonly platformId: PlatformId;
    private attached;
    private readonly cordova;
    constructor(cordova: CordovaExecHost | null, platformId?: PlatformId);
    static create(platformId?: PlatformId): CordovaBridge;
    call<T = unknown>(action: string, args?: readonly unknown[]): Promise<T>;
    /**
     * Installs the native event bridge. The callback is keep-alive: every native
     * payload arrives as a JSON string `[eventName, data]`.
     */
    addEventListener(listener: (event: NativeEvent) => void, onTransportError?: (error: FCMError) => void): () => void;
}
