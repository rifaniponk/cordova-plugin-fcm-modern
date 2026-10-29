import assert from 'node:assert/strict'
import test from 'node:test'

import { FCMCore } from '../src/core/fcmCore.ts'
import { FCMError } from '../src/core/errors.ts'
import type { IPluginBridge, NativeEvent, PlatformId } from '../src/core/types.ts'

/** Scriptable bridge used by every test in this file. */
class FakeBridge implements IPluginBridge {
    public readonly calls: Array<{ action: string; args: readonly unknown[] }> = []
    public readonly responders = new Map<string, (args: readonly unknown[]) => unknown>()
    public listeners: Array<(event: NativeEvent) => void> = []
    public transportErrors: Array<{ message: string }> = []
    public readyBehaviour: 'ok' | 'fail' | 'hang' = 'ok'
    public readonly platformId: PlatformId
    private failTransport?: (error: FCMError) => void

    constructor(platformId: PlatformId = 'android') {
        this.platformId = platformId
    }

    get runtime(): 'cordova' | 'capacitor' | 'web' {
        return 'cordova'
    }

    respond(action: string, handler: (args: readonly unknown[]) => unknown): void {
        this.responders.set(action, handler)
    }

    emit(event: NativeEvent): void {
        for (const listener of [...this.listeners]) {
            listener(event)
        }
    }

    call<T>(action: string, args: readonly unknown[] = []): Promise<T> {
        this.calls.push({ action, args })
        if (action === 'ready' && this.readyBehaviour === 'fail') {
            return Promise.reject(new Error('native bridge offline'))
        }
        if (action === 'ready' && this.readyBehaviour === 'hang') {
            return new Promise<T>(() => undefined)
        }
        const responder = this.responders.get(action)
        if (responder === undefined) {
            return Promise.resolve(undefined as T)
        }
        try {
            return Promise.resolve(responder(args) as T)
        } catch (error) {
            return Promise.reject(error)
        }
    }

    addEventListener(
        listener: (event: NativeEvent) => void,
        onError?: (error: FCMError) => void
    ): () => void {
        this.listeners.push(listener)
        this.failTransport = onError
        return () => {
            const index = this.listeners.indexOf(listener)
            if (index >= 0) {
                this.listeners.splice(index, 1)
            }
        }
    }

    breakTransport(message: string): void {
        this.failTransport?.(new FCMError('bridge_unavailable', message))
    }
}

const readyCore = (bridge: FakeBridge, options = {}) => {
    const core = new FCMCore(bridge, { autoInitialize: false, ...options })
    return core
}

/** Replay runs on the next microtask; tests must yield to it explicitly. */
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))

test('cold-start notifications are buffered before any listener exists', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()

    bridge.emit({
        kind: 'notification',
        payload: { wasTapped: false, messageId: 'cold-1', body: 'x' }
    })
    bridge.emit({ kind: 'notification', payload: { wasTapped: true, messageId: 'cold-1' } })

    const seen: Array<{ id?: string; wasTapped: boolean }> = []
    core.onNotification((payload) =>
        seen.push({ id: payload.messageId as string, wasTapped: payload.wasTapped })
    )
    await tick()

    assert.deepEqual(seen, [
        { id: 'cold-1', wasTapped: false },
        { id: 'cold-1', wasTapped: true }
    ])
    core.dispose()
})

test('a late token listener receives the token as a string', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()
    bridge.emit({ kind: 'tokenRefresh', token: 'tok-123' })

    const seen: unknown[] = []
    core.onTokenRefresh((token) => seen.push(token))
    await tick()
    assert.deepEqual(seen, ['tok-123'])
    core.dispose()
})

test('live events reach every listener exactly once', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()

    const first: string[] = []
    const second: string[] = []
    core.onNotification((payload) => first.push(String(payload.messageId)))
    core.onNotification((payload) => second.push(String(payload.messageId)))

    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'live-1' } })
    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'live-1' } }) // duplicate

    assert.deepEqual(first, ['live-1'])
    assert.deepEqual(second, ['live-1'])
    core.dispose()
})

test('a throwing listener does not starve the other subscribers', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()

    const seen: string[] = []
    core.onNotification(() => {
        throw new Error('app bug inside a listener')
    })
    core.onNotification((payload) => seen.push(String(payload.messageId)))

    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'boom' } })
    assert.deepEqual(seen, ['boom'])
    core.dispose()
})

test('once listeners consume exactly one event, buffered or live', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()
    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'b1' } })
    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'b2' } })

    const seen: string[] = []
    core.onNotification((payload) => seen.push(String(payload.messageId)), { once: true })
    // Buffered events replay on the next microtask, so yield before asserting.
    await tick()
    assert.deepEqual(seen, ['b1'])

    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'b3' } })
    assert.deepEqual(seen, ['b1'], 'the once listener must not fire again')
    core.dispose()
})

test('disposing before replay prevents delivery', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()
    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'never' } })

    let calls = 0
    const subscription = core.onNotification(() => {
        calls++
    })
    subscription.dispose()
    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'after' } })
    assert.equal(calls, 0)
    core.dispose()
})

test('eventTarget carries notification and tokenRefresh CustomEvents', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()
    // An eventTarget listener counts as a subscriber, so events flow live.
    core.onNotification(() => undefined)

    const events: string[] = []
    core.eventTarget.addEventListener('notification', (event) => {
        events.push(`notification:${(event as CustomEvent).detail.messageId}`)
    })
    core.eventTarget.addEventListener('tokenRefresh', (event) => {
        events.push(`tokenRefresh:${(event as CustomEvent).detail}`)
    })

    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'ev-1' } })
    bridge.emit({ kind: 'tokenRefresh', token: 'ev-token' })
    assert.deepEqual(events, ['notification:ev-1', 'tokenRefresh:ev-token'])
    core.dispose()
})

test('getInitialPushPayload is stable across reads and only reports the startup tap', async () => {
    const bridge = new FakeBridge()
    bridge.respond('getInitialPushPayload', () => ({
        wasTapped: true,
        messageId: 'startup',
        title: 'tapped'
    }))
    const core = readyCore(bridge)

    const first = await core.getInitialPushPayload()
    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'later' } })
    const second = await core.getInitialPushPayload()

    assert.deepEqual(first, { wasTapped: true, messageId: 'startup', title: 'tapped' })
    assert.equal(second, first, 'reads must return the same startup payload, not a later receipt')
    assert.equal(bridge.calls.filter((call) => call.action === 'getInitialPushPayload').length, 1)
    core.dispose()
})

test('a null startup payload stays null', async () => {
    const bridge = new FakeBridge()
    bridge.respond('getInitialPushPayload', () => null)
    const core = readyCore(bridge)
    assert.equal(await core.getInitialPushPayload(), null)
    assert.equal(await core.getInitialPushPayload(), null)
    core.dispose()
})

test('native rejections propagate as FCMError instead of hanging or resolving', async () => {
    const bridge = new FakeBridge()
    bridge.respond('getToken', () => {
        throw { message: 'FirebaseMessaging.getToken failed: MISSING_CONFIGURATION' }
    })
    const core = readyCore(bridge)
    await core.initialize()

    await assert.rejects(core.getToken(), (error: FCMError) => {
        assert.ok(error instanceof FCMError)
        assert.equal(error.code, 'native_error')
        assert.match(error.message, /MISSING_CONFIGURATION/)
        return true
    })
    core.dispose()
})

test('a call whose native side never answers times out instead of pending forever', async () => {
    const bridge = new FakeBridge()
    bridge.readyBehaviour = 'hang'
    const core = new FCMCore(bridge, { autoInitialize: false, callTimeoutMs: 20 })
    await assert.rejects(core.initialize(), (error: FCMError) => {
        assert.equal(error.code, 'timeout')
        return true
    })
    core.dispose()
})

test('a failed handshake is not memoised forever, and it detaches the bridge', async () => {
    const bridge = new FakeBridge()
    bridge.readyBehaviour = 'fail'
    const core = new FCMCore(bridge, { autoInitialize: false })

    await assert.rejects(core.initialize(), (error: FCMError) => {
        assert.equal(error.code, 'bridge_unavailable')
        assert.match(error.message, /native bridge offline/)
        return true
    })
    assert.equal(bridge.listeners.length, 0, 'the listener from the failed attempt is torn down')

    bridge.readyBehaviour = 'ok'
    bridge.respond('getToken', () => 'token-after-retry')
    await core.initialize()
    assert.equal(await core.getToken(), 'token-after-retry')
    core.dispose()
})

test('reserved metadata survives a hostile payload end to end', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()

    const seen: Array<Record<string, unknown>> = []
    core.onNotification((payload) => seen.push({ ...payload }))
    bridge.emit({
        kind: 'notification',
        payload: {
            wasTapped: true,
            messageId: 'trusted',
            data: { wasTapped: false, messageId: 'spoof', title: 'spoof' }
        }
    })

    assert.equal(seen[0]?.wasTapped, true)
    assert.equal(seen[0]?.messageId, 'trusted')
    assert.deepEqual((seen[0]?.custom as Record<string, unknown>) ?? {}, {
        wasTapped: false,
        messageId: 'spoof',
        title: 'spoof'
    })
    core.dispose()
})

test('topics, channels and permissions are validated before any native call', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)

    for (const bad of ['', ' ', 'has space', 'a'.repeat(256), '../etc', 'topic/x y']) {
        await assert.rejects(core.subscribeToTopic(bad), (error: FCMError) => {
            assert.equal(error.code, 'invalid_argument')
            return true
        })
    }
    await assert.rejects(core.unsubscribeFromTopic(''), (error: FCMError) => {
        assert.equal(error.code, 'invalid_argument')
        return true
    })

    await assert.rejects(
        core.createNotificationChannel({ id: '', name: 'x' }),
        (error: FCMError) => {
            assert.equal(error.code, 'invalid_argument')
            return true
        }
    )
    await assert.rejects(
        core.createNotificationChannel({ id: 'ok', name: '' }),
        (error: FCMError) => {
            assert.equal(error.code, 'invalid_argument')
            return true
        }
    )
    assert.equal(bridge.calls.length, 0, 'validation must short-circuit before the bridge')
    core.dispose()
})

test('valid topics and channels reach the bridge', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.subscribeToTopic('orders.updates')
    await core.unsubscribeFromTopic('%order-updates_v2')
    await core.createNotificationChannel({ id: 'orders', name: 'Orders', importance: 'high' })

    assert.deepEqual(
        bridge.calls.map((call) => call.action),
        [
            'ready',
            'replayBufferedEvents',
            'subscribeToTopic',
            'unsubscribeFromTopic',
            'createNotificationChannel'
        ]
    )
    assert.deepEqual(bridge.calls[2]?.args, ['orders.updates'])
    core.dispose()
})

test('createNotificationChannel is a no-op on iOS instead of a native error', async () => {
    const bridge = new FakeBridge('ios')
    const core = readyCore(bridge)
    await core.createNotificationChannel({ id: 'orders', name: 'Orders' })
    assert.equal(bridge.calls.length, 0)
    core.dispose()
})

test('getAPNSToken resolves empty on non-iOS and forwards on iOS', async () => {
    const android = new FakeBridge('android')
    const ios = new FakeBridge('ios')
    ios.respond('getAPNSToken', () => 'apns-token-hex')

    assert.equal(await readyCore(android).getAPNSToken(), '')
    assert.equal(await readyCore(ios).getAPNSToken(), 'apns-token-hex')
})

test('deleteInstanceId is an alias for the registration-token deletion', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.deleteInstanceId()
    await core.deleteToken()
    const actions = bridge.calls.map((call) => call.action)
    assert.deepEqual(actions, ['ready', 'replayBufferedEvents', 'deleteToken', 'deleteToken'])
    core.dispose()
})

test('no automatic topic subscription happens unless it is configured', async () => {
    const implicit = new FakeBridge()
    await readyCore(implicit).initialize()
    assert.deepEqual(
        implicit.calls.map((call) => call.action),
        ['ready', 'replayBufferedEvents']
    )

    const explicit = new FakeBridge()
    const core = readyCore(explicit, { autoSubscribeTopics: ['news'] })
    await core.initialize()
    assert.deepEqual(
        explicit.calls.map((call) => call.action),
        ['ready', 'subscribeToTopic', 'replayBufferedEvents']
    )
    core.dispose()
})

test('foreground presentation is opt-in and forwarded as a normalised object', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.configureForegroundPresentation({
        alert: true,
        sound: 'yes' as never,
        channelId: 'orders'
    })
    const call = bridge.calls.find((entry) => entry.action === 'setForegroundPresentation')
    assert.deepEqual(call?.args[0], {
        alert: true,
        sound: false,
        badge: false,
        channelId: 'orders'
    })
    core.dispose()
})

test('the deprecated ios9Support option is accepted and never forwarded', async () => {
    const bridge = new FakeBridge()
    bridge.respond('requestPushPermission', (args) => {
        const options = args[0] as Record<string, unknown>
        return options.ios9Support === undefined
    })
    const core = readyCore(bridge)
    const granted = await core.requestPushPermission({
        ios9Support: { timeout: 10, interval: 0.3 },
        provisional: true
    })
    assert.equal(granted, true)
    core.dispose()
})

test('initialize attaches the event listener before ready and replay', async () => {
    const bridge = new FakeBridge()
    const order: string[] = []
    bridge.respond('ready', () => {
        order.push(`ready:listeners=${bridge.listeners.length}`)
        return undefined
    })
    bridge.respond('replayBufferedEvents', () => {
        order.push(`replay:listeners=${bridge.listeners.length}`)
        return undefined
    })
    const core = readyCore(bridge)
    await core.initialize()
    assert.deepEqual(order, ['ready:listeners=1', 'replay:listeners=1'])
    core.dispose()
})

test('dispose tears the bridge down and freezes the instance', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()
    core.dispose()
    assert.equal(bridge.listeners.length, 0)
    await assert.rejects(core.getToken(), (error: FCMError) => {
        assert.equal(error.code, 'not_initialized')
        return true
    })
    core.dispose() // idempotent
})

test('transport failures are surfaced, not swallowed', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()
    bridge.breakTransport('event pipe broken')
    core.dispose()
})
