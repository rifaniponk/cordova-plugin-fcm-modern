import type { IPluginBridge, NativeEvent, PlatformId, RuntimeId } from './types.js';
import type { FCMError } from './errors.js';
/**
 * Defers bridge creation until the first native call, and — for the Capacitor
 * route — keeps `@capacitor/core` behind a dynamic import so a plain Cordova app
 * never needs the Capacitor peer dependency installed.
 *
 * Ordering guarantee: the event listener is attached to the real bridge *before*
 * the core issues `ready`/`replayBufferedEvents`, so a cold-start burst cannot
 * be emitted into a world with no receiver.
 */
export declare class RuntimeBridge implements IPluginBridge {
    readonly runtime: RuntimeId;
    readonly platformId: PlatformId;
    private inner;
    private pendingListener;
    private pendingErrorHandler;
    private innerTeardown;
    private detached;
    private readonly loader;
    constructor(loader: (runtime: RuntimeId) => Promise<IPluginBridge>, detected?: {
        runtime: RuntimeId;
        platformId: PlatformId;
    });
    private resolveBridge;
    call<T = unknown>(action: string, args?: readonly unknown[]): Promise<T>;
    addEventListener(listener: (event: NativeEvent) => void, onError?: (error: FCMError) => void): () => void;
    /** Exposed for tests and diagnostics; never used to make a promise pend. */
    bridgeState(): {
        resolved: boolean;
        runtime: RuntimeId;
        platformId: PlatformId;
    };
}
