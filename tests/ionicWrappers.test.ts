import assert from 'node:assert/strict'
import test from 'node:test'

import { Observable } from 'rxjs'
import { take } from 'rxjs/operators'

import { FCMCore } from '../src/core/fcmCore.ts'
import { resetSharedFCM, sharedFCMKey } from '../src/core/instance.ts'
import type {
    IListenOptions,
    INotificationPayload,
    IPluginBridge,
    NativeEvent,
    PlatformId
} from '../src/core/types.ts'

import * as legacy from '../src/ionic/index.ts'
import { FCMIonicBase, FCMPluginOnIonic } from '../src/ionic/index.ts'
import { FCM as NgxFCM, provideFCM as provideNgx } from '../src/ionic/ngx/index.ts'
import { FCM as V4FCM, provideFCM as provideV4 } from '../src/ionic/v4/index.ts'

/**
 * These tests use the real rxjs and the real Angular injector. There is no
 * observable stub and no provider-shaped assertion standing in for DI: a fake
 * cannot prove that `pipe`/`take`/teardown or `inject(FCM)` actually work, and
 * those are exactly what an Ionic upgrade depends on.
 */

/** Scriptable bridge: the wrappers must behave through the real core path. */
class FakeBridge implements IPluginBridge {
    public readonly calls: Array<{ action: string; args: readonly unknown[] }> = []
    public readonly platformId: PlatformId = 'android'
    public runtime: 'cordova' | 'capacitor' | 'web' = 'cordova'
    private listeners: Array<(event: NativeEvent) => void> = []
    public teardowns = 0

    call<T>(action: string, args: readonly unknown[] = []): Promise<T> {
        this.calls.push({ action, args })
        return Promise.resolve(undefined as T)
    }

    addEventListener(listener: (event: NativeEvent) => void): () => void {
        this.listeners.push(listener)
        return () => {
            this.teardowns += 1
            this.listeners = this.listeners.filter((candidate) => candidate !== listener)
        }
    }

    actionNames(): string[] {
        return this.calls.map((call) => call.action)
    }

    emit(event: NativeEvent): void {
        for (const listener of [...this.listeners]) {
            listener(event)
        }
    }
}

/**
 * The wrappers take the process-wide shared instance, so seeding that key with a
 * fake-backed core proves they reuse it instead of opening a second native sink.
 *
 * `emit()` only reaches a wrapper once the core has attached its bridge listener,
 * which `initialize()` does — so every behaviour test awaits this. Seeding an
 * un-initialised core and emitting straight away would assert against a bridge
 * that has no listener at all, i.e. it would prove nothing about delivery.
 */
const seedShared = async (bridge: IPluginBridge): Promise<FCMCore> => {
    const core = new FCMCore(bridge, { autoInitialize: false })
    ;(globalThis as unknown as Record<symbol, FCMCore>)[sharedFCMKey] = core
    await core.initialize()
    return core
}

const notification = (messageId: string): NativeEvent => ({
    kind: 'notification',
    payload: { wasTapped: false, messageId, title: `t-${messageId}` }
})

/** Next-turn flush: the core replays buffered events from a microtask. */
const tick = (): Promise<void> => new Promise<void>((resolve) => queueMicrotask(resolve))

const PUBLIC_METHODS = [
    'getToken',
    'deleteToken',
    'deleteInstanceId',
    'getAPNSToken',
    'getInitialPushPayload',
    'hasPermission',
    'requestPushPermission',
    'subscribeToTopic',
    'unsubscribeFromTopic',
    'clearAllNotifications',
    'createNotificationChannel',
    'setAutoInitEnabled',
    'isAutoInitEnabled',
    'initialize',
    'ready',
    'dispose'
]

/** The 7.x contract: these two names return Observables, not IDisposable handles. */
const OBSERVABLE_METHODS = ['onNotification', 'onTokenRefresh']

test('every ionic subpath keeps the 7.x public method names', () => {
    assert.ok(legacy.FCM instanceof FCMPluginOnIonic, 'the legacy export is a wrapper instance')
    for (const target of [legacy.FCM]) {
        for (const method of [...PUBLIC_METHODS, ...OBSERVABLE_METHODS]) {
            assert.equal(
                typeof (target as unknown as Record<string, unknown>)[method],
                'function',
                `the shared instance lost ${method}`
            )
        }
    }
    // The 7.x class name is still the core alias inherited through `export *`, so
    // old typings compile; only the *instance* export is Observable-shaped here.
    assert.equal(legacy.FCMPlugin, FCMCore, 'FCMPlugin stays the 7.x core class alias')
    for (const classTarget of [FCMPluginOnIonic, NgxFCM, V4FCM]) {
        for (const method of [...PUBLIC_METHODS, ...OBSERVABLE_METHODS]) {
            assert.equal(
                typeof (classTarget.prototype as unknown as Record<string, unknown>)[method],
                'function',
                `${classTarget.name} lost ${method}`
            )
        }
    }
})

test('the legacy ionic FCM is a wrapper over the shared core, not the core itself', () => {
    // The root core binds onNotification to a disposable handle; the Ionic entry
    // binds it to an Observable. One object cannot do both, so the wrapper must be
    // its own object while driving the *same* core.
    //
    // `legacy.FCM` was built at module import, before any test could seed the
    // global, so this compares it against the instance the root entry actually
    // holds — a seeded symbol cannot rebind a wrapper's readonly core field, and an
    // assertion that pretends otherwise tests nothing. Fresh wrappers do resolve
    // whatever core is seeded then (see the shared-core test).
    assert.notEqual(legacy.FCM, legacy['FCMPlugin'], 'the ionic instance is not a core class')
    assert.notEqual(
        legacy.FCM.core,
        undefined,
        'the ionic wrapper holds a core, it is not itself one'
    )
    assert.equal(typeof legacy.FCM.core.onNotification, 'function')
    assert.ok(legacy.FCM instanceof FCMIonicBase)
})

test('a freshly built wrapper adopts the core seeded at construction time', () => {
    const bridge = new FakeBridge()
    const seeded = new FCMCore(bridge, { autoInitialize: false })
    ;(globalThis as unknown as Record<symbol, FCMCore>)[sharedFCMKey] = seeded
    const wrapper = new FCMPluginOnIonic()
    assert.equal(wrapper.core, seeded, 'a new wrapper resolves the seeded core')
    assert.notEqual(wrapper, seeded, 'the wrapper is a distinct object from the core')
    resetSharedFCM()
})

test('onNotification/onTokenRefresh return real RxJS Observables (7.x upgrade contract)', async () => {
    const bridge = new FakeBridge()
    await seedShared(bridge)
    const wrapper = new FCMPluginOnIonic()

    for (const [name, stream] of [
        ['onNotification', wrapper.onNotification()],
        ['onTokenRefresh', wrapper.onTokenRefresh()]
    ] as const) {
        assert.ok(stream instanceof Observable, `${name} must return a real rxjs Observable`)
        assert.equal(typeof stream.pipe, 'function', `${name} lost pipe(), so 7.x code breaks`)
    }

    // A 7.x app chains rxjs operators onto these streams.
    const piped = wrapper.onNotification().pipe(take(1))
    assert.ok(piped instanceof Observable, 'pipe() must yield an Observable')

    const seen: string[] = []
    const sub = piped.subscribe({
        next: (payload) => seen.push(String(payload.messageId))
    })
    await tick()
    bridge.emit(notification('m-pipe'))
    await tick()
    bridge.emit(notification('m-pipe-2'))
    await tick()
    assert.deepEqual(seen, ['m-pipe'], 'take() completed the chain')
    assert.equal(sub.closed, true, 'rxjs tore the subscription down on complete')
    wrapper.dispose()
})

test('additive 8.x auto-init and presentation methods are forwarded', async () => {
    const bridge = new FakeBridge()
    await seedShared(bridge)
    const wrapper = new FCMPluginOnIonic()
    await wrapper.configureForegroundPresentation({ sound: true })
    await wrapper.setAutoInitEnabled(true)
    await wrapper.isAutoInitEnabled()
    wrapper.setAutoSubscribeTopics(['news'])
    assert.ok(bridge.actionNames().includes('setForegroundPresentation'))
    assert.ok(bridge.actionNames().includes('setAutoInitEnabled'))
    assert.ok(bridge.actionNames().includes('isAutoInitEnabled'))
    wrapper.dispose()
})

test('topic calls reach the bridge with the native transport shape', async () => {
    const bridge = new FakeBridge()
    await seedShared(bridge)
    const wrapper = new NgxFCM()
    await wrapper.subscribeToTopic('news')
    await wrapper.unsubscribeFromTopic('news')
    const topicCalls = bridge.calls.filter((call) => call.action.endsWith('Topic'))
    assert.deepEqual(
        topicCalls.map((call) => [call.action, call.args]),
        [
            ['subscribeToTopic', ['news']],
            ['unsubscribeFromTopic', ['news']]
        ]
    )
    wrapper.dispose()
})

test('all wrappers drive one shared FCMCore, not three competing sinks', async () => {
    const bridge = new FakeBridge()
    const seeded = await seedShared(bridge)

    const a = new FCMPluginOnIonic()
    const b = new NgxFCM()
    const c = new V4FCM()
    assert.equal(a.core, seeded)
    assert.equal(b.core, seeded)
    assert.equal(c.core, seeded)
    assert.equal(bridge.teardowns, 0, 'constructing wrappers must never tear the bridge down')

    // Both Ionic event methods ride the same singleton: one stream opened through
    // one wrapper and another through a different wrapper share one native sink.
    const seen: string[] = []
    const subA = new FCMPluginOnIonic().onNotification().subscribe({
        next: (payload) => seen.push(String(payload.messageId))
    })
    const subB = c.onTokenRefresh().subscribe({ next: (token) => seen.push(token) })
    await tick()
    bridge.emit(notification('m-shared'))
    bridge.emit({ kind: 'tokenRefresh', token: 'tok-shared' })
    assert.deepEqual(seen, ['m-shared', 'tok-shared'])
    subA.unsubscribe()
    subB.unsubscribe()
    void b
    a.dispose()
})

test('unsubscribe disposes the listener handle exactly once and stops delivery', async () => {
    const bridge = new FakeBridge()
    const core = await seedShared(bridge)
    const wrapper = new FCMPluginOnIonic()

    // `FakeBridge.teardowns` counts the *shared native event bridge* teardown, so
    // it must NOT move when one Ionic subscription ends — that would detach every
    // other listener in the app. What has to be exactly-once is the IDisposable the
    // core handed the wrapper, so spy on that handle instead.
    const realOnNotification = core.onNotification.bind(core)
    let disposals = 0
    let handles = 0
    core.onNotification = ((
        callback: (p: INotificationPayload) => void,
        options?: IListenOptions
    ) => {
        const handle = realOnNotification(callback, options)
        handles += 1
        return {
            dispose: () => {
                disposals += 1
                handle.dispose()
            }
        }
    }) as typeof core.onNotification

    const received: string[] = []
    const sub = wrapper.onNotification().subscribe({
        next: (payload) => received.push(String(payload.messageId))
    })
    await tick()
    bridge.emit(notification('m-1'))
    assert.deepEqual(received, ['m-1'])

    sub.unsubscribe()
    sub.unsubscribe()
    assert.equal(handles, 1, 'one subscription attaches one core handle')
    assert.equal(disposals, 1, 'the handle must be disposed exactly once')
    assert.equal(bridge.teardowns, 0, 'an Ionic unsubscribe must not detach the shared bridge')

    bridge.emit(notification('m-2'))
    assert.deepEqual(received, ['m-1'], 'unsubscribe detached the native subscription')
    wrapper.dispose()
})

test('take(1) via rxjs operators tears the listener handle down', async () => {
    const bridge = new FakeBridge()
    await seedShared(bridge)
    const wrapper = new NgxFCM()

    const seen: string[] = []
    wrapper
        .onNotification()
        .pipe(take(1))
        .subscribe({
            next: (payload) => seen.push(String(payload.messageId))
        })
    await tick()
    bridge.emit(notification('m-take'))
    await tick()
    bridge.emit(notification('m-take-2'))
    await tick()
    assert.deepEqual(seen, ['m-take'], 'take() completed and released the listener')

    // Proof of release, not just `Subscription.closed`: a second stream must still
    // get the event the dead one would have swallowed had its handle leaked. Only
    // m-take-2 can reach it — an empty stream buffers nothing, so the queue is
    // exactly what the live listener should see.
    const second: string[] = []
    wrapper.onNotification().subscribe({
        next: (payload) => second.push(String(payload.messageId))
    })
    await tick()
    bridge.emit(notification('m-take-3'))
    await tick()
    assert.deepEqual(
        second,
        ['m-take-2', 'm-take-3'],
        'the released listener must not consume events'
    )
    wrapper.dispose()
})

test('once completes the observable and releases a handle assigned after replay', async () => {
    const bridge = new FakeBridge()
    const core = await seedShared(bridge)
    const wrapper = new V4FCM()

    // The core replays a buffered event from a microtask, i.e. after subscribe()
    // has returned but before any caller could unsubscribe. The completion path
    // must still find and dispose that late-arriving handle.
    bridge.emit(notification('m-buffered'))
    await tick()

    let completed = 0
    const seen: string[] = []
    const sub = wrapper.onNotification({ once: true }).subscribe({
        next: (payload) => seen.push(String(payload.messageId)),
        complete: () => {
            completed += 1
        }
    })
    await tick()
    assert.deepEqual(seen, ['m-buffered'], 'a buffered event reaches a late subscriber')
    assert.equal(completed, 1, 'once completes the observable')
    assert.equal(sub.closed, true, 'rxjs tore the subscription down on complete')

    // A released once hook must not consume the next event: if the handle leaked,
    // the dead listener would still be registered and would swallow this one. The
    // core itself buffers events with no subscriber, so a fresh imperative
    // listener sees both — what proves the release is that it sees them *both*,
    // instead of losing the first to a zombie hook.
    bridge.emit(notification('m-after-once'))
    assert.deepEqual(seen, ['m-buffered'], 'a once wrapper never delivers a second event')

    const later: string[] = []
    core.onNotification((payload) => later.push(String(payload.messageId)))
    await tick()
    bridge.emit(notification('m-hold'))
    await tick()
    assert.deepEqual(
        later,
        ['m-after-once', 'm-hold'],
        'the released once hook must not consume events'
    )
    wrapper.dispose()
})

test('an immediately-closed subscription still releases the handle exactly once', async () => {
    const bridge = new FakeBridge()
    const core = await seedShared(bridge)
    const wrapper = new FCMPluginOnIonic()

    // Same reason as the unsubscribe test: the observable's teardown must release
    // the core handle, never the shared native bridge.
    const realOnNotification = core.onNotification.bind(core)
    let disposals = 0
    core.onNotification = ((
        callback: (p: INotificationPayload) => void,
        options?: IListenOptions
    ) => {
        const handle = realOnNotification(callback, options)
        return {
            dispose: () => {
                disposals += 1
                handle.dispose()
            }
        }
    }) as typeof core.onNotification

    const sub = wrapper.onNotification().subscribe()
    await tick()
    sub.unsubscribe()
    sub.unsubscribe()
    assert.equal(disposals, 1, 'the handle assigned during subscribe() must be disposed once')
    assert.equal(bridge.teardowns, 0, 'a dead subscription must not detach the shared bridge')

    const survivor: string[] = []
    core.onNotification((payload) => survivor.push(String(payload.messageId)))
    await tick()
    bridge.emit(notification('m-dead'))
    await tick()
    assert.deepEqual(survivor, ['m-dead'], 'the released subscription must not consume events')
    wrapper.dispose()
})

test('onTokenRefresh observable relays tokens and tears down', async () => {
    const bridge = new FakeBridge()
    await seedShared(bridge)
    const wrapper = new NgxFCM()

    const tokens: string[] = []
    const sub = wrapper.onTokenRefresh().subscribe({ next: (token) => tokens.push(token) })
    await tick()
    bridge.emit({ kind: 'tokenRefresh', token: 'tok-1' })
    assert.deepEqual(tokens, ['tok-1'])
    sub.unsubscribe()
    bridge.emit({ kind: 'tokenRefresh', token: 'tok-2' })
    assert.deepEqual(tokens, ['tok-1'], 'teardown disposed the native subscription')

    // tok-2 was still buffered by the core (no subscriber at the time), so the next
    // once-subscriber legitimately receives it on the replay microtask. Pretending
    // only tok-3 exists would fight the buffer, which is a real 8.x feature.
    const onceTokens: string[] = []
    let completed = 0
    wrapper.onTokenRefresh({ once: true }).subscribe({
        next: (token) => onceTokens.push(token),
        complete: () => {
            completed += 1
        }
    })
    await tick()
    bridge.emit({ kind: 'tokenRefresh', token: 'tok-3' })
    await tick()
    bridge.emit({ kind: 'tokenRefresh', token: 'tok-4' })
    await tick()
    assert.deepEqual(onceTokens, ['tok-2'], 'the once hook took the replayed token and stopped')
    assert.equal(completed, 1)
    wrapper.dispose()
})

test('notification()/tokenRefresh() are aliases of the observable methods', async () => {
    const bridge = new FakeBridge()
    await seedShared(bridge)
    const wrapper = new FCMPluginOnIonic()
    assert.ok(wrapper.notification() instanceof Observable)
    assert.ok(wrapper.tokenRefresh() instanceof Observable)
    const seen: string[] = []
    const sub = wrapper.notification({ once: true }).subscribe({
        next: (payload) => seen.push(String(payload.messageId))
    })
    await tick()
    bridge.emit(notification('m-alias'))
    await tick()
    bridge.emit(notification('m-alias-2'))
    await tick()
    assert.deepEqual(seen, ['m-alias'])
    assert.equal(sub.closed, true)
    wrapper.dispose()
})

test('the imperative escape hatch returns a disposable core handle', async () => {
    const bridge = new FakeBridge()
    await seedShared(bridge)
    const wrapper = new V4FCM()
    const seen: string[] = []
    const handle = wrapper.addNotificationListener((payload) =>
        seen.push(String(payload.messageId))
    )
    assert.equal(typeof handle.dispose, 'function')
    await tick()
    bridge.emit(notification('m-imp'))
    handle.dispose()
    bridge.emit(notification('m-imp-2'))
    assert.deepEqual(seen, ['m-imp'])
    wrapper.dispose()
})

test('provideFCM is injectable through the real Angular injector', async () => {
    const { createEnvironmentInjector } = await import('@angular/core')
    const bridge = new FakeBridge()
    const seeded = await seedShared(bridge)

    for (const [label, FCMClass, provide] of [
        ['ngx', NgxFCM, provideNgx],
        ['v4', V4FCM, provideV4]
    ] as const) {
        // An environment injector's parent must itself be an EnvironmentInjector;
        // `null!` is the explicit isolated root (Angular resolves it to NullInjector).
        const parent = createEnvironmentInjector([], null!)
        const injector = createEnvironmentInjector([provide()], parent, `test:fcm-${label}`)
        const injected = injector.get(FCMClass, undefined)
        assert.ok(injected instanceof FCMIonicBase, `${label}: inject(FCM) resolved nothing`)
        assert.ok(injected instanceof FCMClass, `${label}: the value is not an ${label} FCM`)
        assert.equal(injected.core, seeded, `${label}: the injected FCM is not the shared core`)
        assert.equal(injector.get(FCMClass), injected, `${label}: provider is not a singleton`)
        injector.destroy()
        parent.destroy()
    }
})

test('an invalid callback still surfaces as an error from the imperative core API', () => {
    const bridge = new FakeBridge()
    const core = new FCMCore(bridge, { autoInitialize: false })
    assert.throws(
        () => core.onNotification(undefined as never),
        (error: unknown) => {
            assert.ok(error instanceof Error)
            assert.match(String((error as Error).message), /callback function/)
            return true
        }
    )
})

test('resetting the shared instance leaves no wrapper singleton behind', async () => {
    const first = new FakeBridge()
    const firstCore = await seedShared(first)
    const wrapper = new NgxFCM()
    assert.equal((globalThis as unknown as Record<symbol, FCMCore>)[sharedFCMKey], firstCore)
    wrapper.dispose()
    resetSharedFCM()

    const second = new FakeBridge()
    const secondCore = await seedShared(second)
    const next = new V4FCM({ autoInitialize: false })
    assert.notEqual(next.core, firstCore)
    assert.equal(next.core, secondCore)
    next.dispose()
    resetSharedFCM()
})
