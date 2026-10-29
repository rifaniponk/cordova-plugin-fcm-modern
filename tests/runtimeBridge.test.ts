import assert from 'node:assert/strict'
import test from 'node:test'

import { FCMCore } from '../src/core/fcmCore.ts'
import { FCMError } from '../src/core/errors.ts'
import { RuntimeBridge } from '../src/core/runtimeBridge.ts'
import type { IPluginBridge, NativeEvent } from '../src/core/types.ts'

/**
 * These fixtures model a *native* transport. The test process itself is a bare
 * Node runtime, which `detectRuntime()` reports as `web`, so the detected runtime
 * has to be stated explicitly — otherwise the core's unsupported-web guard fires
 * first and the native paths under test never run.
 */
const native = { runtime: 'cordova', platformId: 'android' } as const

/** A stand-in for a real transport, scriptable enough to model load failures. */
class InnerBridge implements IPluginBridge {
    public readonly runtime = 'cordova' as const
    public readonly platformId = 'android' as const
    public attached = 0
    public teardowns = 0
    public readonly calls: Array<{ action: string; args: readonly unknown[] }> = []
    /** Chronology of native-facing steps, used to assert the handshake order. */
    public readonly order: string[] = []
    public readyBehaviour: 'ok' | 'fail' = 'ok'
    public registrationMs = 0
    private listeners: Array<(event: NativeEvent) => void> = []

    call<T>(action: string, args: readonly unknown[] = []): Promise<T> {
        this.calls.push({ action, args })
        this.order.push(action)
        if (action === 'ready' && this.readyBehaviour === 'fail') {
            return Promise.reject(new Error('native ready failed'))
        }
        return Promise.resolve(undefined as T)
    }

    addEventListener(listener: (event: NativeEvent) => void): () => void {
        this.listeners.push(listener)
        this.attached++
        return () => {
            this.listeners = this.listeners.filter((candidate) => candidate !== listener)
            this.teardowns++
        }
    }

    waitForEventRegistration(): Promise<void> {
        return new Promise((resolve) =>
            setTimeout(() => {
                this.order.push('registration:done')
                resolve()
            }, this.registrationMs)
        )
    }

    emit(event: NativeEvent): void {
        for (const listener of [...this.listeners]) {
            listener(event)
        }
    }
}

test('the deferred bridge resolves once and reuses the same transport', async () => {
    let loads = 0
    const seenRuntimes: string[] = []
    const inner = new InnerBridge()
    const bridge = new RuntimeBridge(async (runtime) => {
        loads++
        seenRuntimes.push(runtime)
        return inner
    }, native)
    assert.equal(bridge.bridgeState().resolved, false)
    assert.deepEqual(
        bridge.bridgeState(),
        { resolved: false, runtime: 'cordova', platformId: 'android' },
        'the declared fixture runtime is what routes the core down the native path'
    )
    await bridge.call('ready')
    await bridge.call('getToken')
    assert.equal(loads, 1)
    assert.deepEqual(seenRuntimes, ['cordova'], 'the loader is told which transport to build')
    assert.equal(bridge.bridgeState().resolved, true)
    assert.deepEqual(
        inner.calls.map((call) => call.action),
        ['ready', 'getToken']
    )
})

test('an ambient web runtime still fails the guard instead of faking a handshake', async () => {
    // This is the *opposite* fixture: no override, so the bridge reports what the
    // bare Node process really is. The unsupported-web guard must stay armed.
    const bridge = new RuntimeBridge(async () => new InnerBridge())
    assert.deepEqual(bridge.bridgeState(), { resolved: false, runtime: 'web', platformId: 'web' })
    const core = new FCMCore(bridge, { autoInitialize: false })
    await assert.rejects(core.initialize(), (error: FCMError) => {
        assert.equal(error.code, 'unsupported_platform')
        assert.equal(error.platform, 'web')
        return true
    })
    core.dispose()
})

test('a failed bridge load is retryable instead of a permanently rejected promise', async () => {
    let loads = 0
    const inner = new InnerBridge()
    const bridge = new RuntimeBridge(async () => {
        loads++
        if (loads === 1) {
            throw new Error('native plugin not registered yet')
        }
        return inner
    }, native)
    await assert.rejects(bridge.call('ready'), /not registered yet/)
    assert.equal(bridge.bridgeState().resolved, false)
    await bridge.call('getToken')
    assert.equal(loads, 2, 'the loader runs again instead of reusing the rejection')
    assert.equal(bridge.bridgeState().resolved, true)
})

test('regression: a retried handshake re-attaches its sink to the resolved bridge', async () => {
    const inner = new InnerBridge()
    inner.readyBehaviour = 'fail'
    const bridge = new RuntimeBridge(async () => inner, native)
    const core = new FCMCore(bridge, { autoInitialize: false })

    await assert.rejects(
        core.initialize(),
        (error: FCMError) => error.code === 'bridge_unavailable'
    )
    assert.equal(inner.attached, 1)
    assert.equal(inner.teardowns, 1, 'the failed attempt must not leave a sink behind')

    inner.readyBehaviour = 'ok'
    await core.initialize()
    assert.equal(inner.attached, 2, 'the retry re-attaches to the already-resolved bridge')

    const seen: string[] = []
    core.onNotification((payload) => seen.push(String(payload.messageId)))
    inner.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'after-retry' } })
    assert.deepEqual(
        seen,
        ['after-retry'],
        'events after a retried handshake must reach the listener live'
    )
    core.dispose()
    assert.equal(inner.teardowns, 2)
})

test('dispose detaches the sink of a resolved bridge immediately', async () => {
    const inner = new InnerBridge()
    const bridge = new RuntimeBridge(async () => inner, native)
    const core = new FCMCore(bridge, { autoInitialize: false })
    await core.initialize()
    core.dispose()
    assert.equal(inner.teardowns, 1)
    inner.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'gone' } })
    await assert.rejects(core.getToken(), (error: FCMError) => error.code === 'not_initialized')
})

test('asynchronous registration is awaited before ready and replay', async () => {
    const inner = new InnerBridge()
    inner.registrationMs = 5
    const core = new FCMCore(new RuntimeBridge(async () => inner, native), {
        autoInitialize: false
    })
    await core.initialize()
    assert.deepEqual(
        inner.order,
        ['registration:done', 'ready', 'replayBufferedEvents'],
        'native must not be asked for events until the listener registration settled'
    )
    core.dispose()
})

test('a registration that never settles times out instead of hanging the handshake', async () => {
    const inner = new InnerBridge()
    inner.waitForEventRegistration = () => new Promise<void>(() => undefined)
    const bridge = new RuntimeBridge(async () => inner, native)
    const core = new FCMCore(bridge, { autoInitialize: false, callTimeoutMs: 20 })
    await assert.rejects(core.initialize(), (error: FCMError) => {
        assert.equal(error.code, 'timeout')
        return true
    })
    assert.equal(inner.teardowns, 1, 'a timed-out registration is torn down too')
    core.dispose()
})
