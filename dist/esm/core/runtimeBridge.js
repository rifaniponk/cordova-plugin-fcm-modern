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
    resolvedInner = null;
    pendingListener = null;
    pendingErrorHandler;
    innerTeardown = null;
    detached = true;
    loader;
    constructor(loader, detected) {
        this.loader = loader;
        const detectedRuntime = detected ?? detectRuntime();
        this.runtime = detectedRuntime.runtime;
        this.platformId = detectedRuntime.platformId;
    }
    resolveBridge() {
        if (this.inner === null) {
            const pending = this.loader(this.runtime).then((bridge) => {
                this.resolvedInner = bridge;
                this.attach();
                return bridge;
            }, (error) => {
                // A failed load must not be memoised: the next call retries
                // the loader instead of inheriting one rejected promise.
                if (this.inner === pending) {
                    this.inner = null;
                }
                throw error;
            });
            this.inner = pending;
        }
        return this.inner;
    }
    /**
     * Attaches the pending listener to whichever bridge object is live right now.
     * Called both after the bridge resolves and when a listener attaches to an
     * already-resolved bridge. Without that second path a core that retried a
     * failed handshake would keep talking to a native transport that has no sink
     * attached, so every cold-start event after the retry would be lost.
     */
    attach() {
        if (this.detached || this.pendingListener === null || this.resolvedInner === null) {
            return;
        }
        if (this.innerTeardown !== null) {
            return;
        }
        this.innerTeardown = this.resolvedInner.addEventListener(this.pendingListener, this.pendingErrorHandler);
    }
    call(action, args = []) {
        return this.resolveBridge().then((bridge) => bridge.call(action, args));
    }
    addEventListener(listener, onError) {
        this.pendingListener = listener;
        this.pendingErrorHandler = onError;
        this.detached = false;
        this.attach();
        return () => {
            this.detached = true;
            this.pendingListener = null;
            if (this.innerTeardown !== null) {
                this.innerTeardown();
                this.innerTeardown = null;
            }
        };
    }
    /**
     * Forwards Capacitor's asynchronous listener registration. Resolving the
     * inner bridge is part of the wait: registration cannot even start before the
     * native plugin object exists.
     */
    waitForEventRegistration() {
        return this.resolveBridge().then((bridge) => bridge.waitForEventRegistration?.());
    }
    /** Exposed for tests and diagnostics; never used to make a promise pend. */
    bridgeState() {
        return {
            resolved: this.resolvedInner !== null,
            runtime: this.runtime,
            platformId: this.platformId
        };
    }
}
