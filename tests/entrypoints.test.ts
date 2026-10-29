import assert from 'node:assert/strict'
import test from 'node:test'

import { resetSharedFCM, sharedFCM, sharedFCMKey } from '../src/core/instance.ts'
import { FCMCore } from '../src/core/fcmCore.ts'

/**
 * Importing an entrypoint is a side effect in production (that is how 7.x
 * consumers got `window.FCM`), so the entrypoints are imported here exactly the
 * way an app would import them — in a bare Node process, which is also the SSR
 * case: no `window`, no `cordova`, no Capacitor.
 */
const root = await import('../src/index.ts')
const cordovaEntry = await import('../src/cordova/index.ts')

test('importing entrypoints in Node does not crash and does not invent a window', () => {
    assert.equal(
        (globalThis as unknown as { window?: unknown }).window,
        undefined,
        'the test process must stay DOM-free for the SSR claim to mean anything'
    )
    assert.ok(root.FCM instanceof FCMCore)
    assert.ok(cordovaEntry.FCM instanceof FCMCore)
})

test('the root and Cordova entrypoints hand out one instance, not competing sinks', () => {
    assert.equal(
        cordovaEntry.FCM,
        root.FCM,
        'a Cordova bundle plus an npm import must share one event sink and buffer'
    )
    assert.equal(
        (globalThis as unknown as Record<symbol, unknown>)[sharedFCMKey],
        root.FCM,
        'the shared instance is keyed by Symbol.for so separate registries find it'
    )
    assert.equal(sharedFCMKey, Symbol.for('cordova-plugin-fcm-modern.fcm.instance'))
})

test('sharedFCM reuses the existing instance and createFCM makes an explicit one', () => {
    assert.equal(
        sharedFCM(() => new FCMCore(cordovaEntry.CordovaBridge.create())),
        root.FCM
    )
    const explicit = cordovaEntry.createFCM({ autoInitialize: false })
    assert.notEqual(
        explicit,
        root.FCM,
        "an explicit factory call is still the caller's own instance"
    )
    explicit.dispose()
})

test('the 7.x class name survives as an alias of the one core', () => {
    assert.equal(
        root.FCMPlugin,
        FCMCore,
        'FCMPlugin must be the same class, not a second implementation with its own semantics'
    )
    assert.equal(cordovaEntry.FCMPlugin, FCMCore)

    const legacy = new root.FCMPlugin(cordovaEntry.CordovaBridge.create(), {
        autoInitialize: false
    })
    assert.ok(legacy instanceof FCMCore)
    assert.equal(typeof legacy.getToken, 'function')
    legacy.dispose()
})

test('an uninitialised native call rejects instead of hanging an SSR render', async () => {
    const standalone = cordovaEntry.createFCM()
    await assert.rejects(standalone.getToken(), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /Cordova bridge is not present/)
        return true
    })
    // The shared instance is runtime-routed, so in a DOM-less process it fails the
    // same way: fast and explicit, never a promise that pends forever.
    await assert.rejects(cordovaEntry.FCM.getToken())
    standalone.dispose()
})

test('resetting the shared instance is possible for isolated consumers', () => {
    const before = root.FCM
    resetSharedFCM()
    const after = sharedFCM(() => new FCMCore(cordovaEntry.CordovaBridge.create(), {}))
    assert.notEqual(after, before)
    after.dispose()
    assert.equal(
        sharedFCM(() => after),
        after,
        'the replacement is now the shared instance'
    )
    resetSharedFCM()
})
