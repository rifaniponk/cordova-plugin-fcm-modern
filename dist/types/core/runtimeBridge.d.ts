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
    private resolvedInner;
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
    /**
     * Attaches the pending listener to whichever bridge object is live right now.
     * Called both after the bridge resolves and when a listener attaches to an
     * already-resolved bridge. Without that second path a core that retried a
     * failed handshake would keep talking to a native transport that has no sink
     * attached, so every cold-start event after the retry would be lost.
     */
    private attach;
    call<T = unknown>(action: string, args?: readonly unknown[]): Promise<T>;
    addEventListener(listener: (event: NativeEvent) => void, onError?: (error: FCMError) => void): () => void;
    /**
     * Forwards Capacitor's asynchronous listener registration. Resolving the
     * inner bridge is part of the wait: registration cannot even start before the
     * native plugin object exists.
     */
    waitForEventRegistration(): Promise<void>;
    /** Exposed for tests and diagnostics; never used to make a promise pend. */
    bridgeState(): {
        resolved: boolean;
        runtime: RuntimeId;
        platformId: PlatformId;
    };
}
