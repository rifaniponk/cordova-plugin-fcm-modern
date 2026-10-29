import { detectRuntime } from './runtime.js';
/**
 * Defers bridge creation until the first native call, and — for the Capacitor
 * route — keeps `@capacitor/core` behind a dynamic import so a plain Cordova app
 * never needs the Capacitor peer dependency installed.
 *
 * Ordering guarantee: the event listener is attached to the real bridge *before*
 * the core issues `ready`/`replayBufferedEvents`, so a cold-start burst cannot
 * be emitted into a world with no receiver.
 */
export class RuntimeBridge {
    runtime;
    platformId;
    inner = null;
    pendingListener = null;
    pendingErrorHandler;
    innerTeardown = null;
    detached = false;
    loader;
    constructor(loader, detected) {
        this.loader = loader;
        const detectedRuntime = detected ?? detectRuntime();
        this.runtime = detectedRuntime.runtime;
        this.platformId = detectedRuntime.platformId;
    }
    resolveBridge() {
        if (this.inner === null) {
            this.inner = this.loader(this.runtime).then((bridge) => {
                if (this.detached) {
                    return bridge;
                }
                if (this.pendingListener !== null) {
                    this.innerTeardown = bridge.addEventListener(this.pendingListener, this.pendingErrorHandler);
                }
                return bridge;
            });
        }
        return this.inner;
    }
    call(action, args = []) {
        return this.resolveBridge().then((bridge) => bridge.call(action, args));
    }
    addEventListener(listener, onError) {
        this.pendingListener = listener;
        this.pendingErrorHandler = onError;
        this.detached = false;
        return () => {
            this.detached = true;
            this.pendingListener = null;
            if (this.innerTeardown !== null) {
                this.innerTeardown();
                this.innerTeardown = null;
            }
        };
    }
    /** Exposed for tests and diagnostics; never used to make a promise pend. */
    bridgeState() {
        return { resolved: this.inner !== null, runtime: this.runtime, platformId: this.platformId };
    }
}
