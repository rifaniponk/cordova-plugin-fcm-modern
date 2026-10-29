import { detectRuntime } from './runtime.js'
import type { IPluginBridge, NativeEvent, PlatformId, RuntimeId } from './types.js'
import type { FCMError } from './errors.js'

/**
 * Defers bridge creation until the first native call, and — for the Capacitor
 * route — keeps `@capacitor/core` behind a dynamic import so a plain Cordova app
 * never needs the Capacitor peer dependency installed.
 *
 * Ordering guarantee: the event listener is attached to the real bridge *before*
 * the core issues `ready`/`replayBufferedEvents`, so a cold-start burst cannot
 * be emitted into a world with no receiver.
 */
export class RuntimeBridge implements IPluginBridge {
    public readonly runtime: RuntimeId
    public readonly platformId: PlatformId

    private inner: Promise<IPluginBridge> | null = null
    private pendingListener: ((event: NativeEvent) => void) | null = null
    private pendingErrorHandler: ((error: FCMError) => void) | undefined
    private innerTeardown: (() => void) | null = null
    private detached = false
    private readonly loader: (runtime: RuntimeId) => Promise<IPluginBridge>

    constructor(
        loader: (runtime: RuntimeId) => Promise<IPluginBridge>,
        detected?: { runtime: RuntimeId; platformId: PlatformId }
    ) {
        this.loader = loader
        const detectedRuntime = detected ?? detectRuntime()
        this.runtime = detectedRuntime.runtime
        this.platformId = detectedRuntime.platformId
    }

    private resolveBridge(): Promise<IPluginBridge> {
        if (this.inner === null) {
            this.inner = this.loader(this.runtime).then((bridge) => {
                if (this.detached) {
                    return bridge
                }
                if (this.pendingListener !== null) {
                    this.innerTeardown = bridge.addEventListener(
                        this.pendingListener,
                        this.pendingErrorHandler
                    )
                }
                return bridge
            })
        }
        return this.inner
    }

    public call<T = unknown>(action: string, args: readonly unknown[] = []): Promise<T> {
        return this.resolveBridge().then((bridge) => bridge.call<T>(action, args))
    }

    public addEventListener(
        listener: (event: NativeEvent) => void,
        onError?: (error: FCMError) => void
    ): () => void {
        this.pendingListener = listener
        this.pendingErrorHandler = onError
        this.detached = false
        return () => {
            this.detached = true
            this.pendingListener = null
            if (this.innerTeardown !== null) {
                this.innerTeardown()
                this.innerTeardown = null
            }
        }
    }

    /** Exposed for tests and diagnostics; never used to make a promise pend. */
    public bridgeState(): { resolved: boolean; runtime: RuntimeId; platformId: PlatformId } {
        return { resolved: this.inner !== null, runtime: this.runtime, platformId: this.platformId }
    }
}
