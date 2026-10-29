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
    public attachFailure?: string
    /** How many times the core detached a stream (teardown functions ran). */
    public teardowns = 0
    /** Returning a rejected `ready` lets a test model "native is offline right now". */
    public readyFail?: string
    public readonly platformId: PlatformId
    private failTransports: Array<(error: FCMError) => void> = []

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
        if (action === 'ready' && this.readyFail !== undefined) {
            return Promise.reject(new Error(this.readyFail))
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
        // The attachment slot is monotonic: a detached generation keeps its
        // own (now inactive) callback so breakTransportAt(0) really models a
        // stale callback from a dead stream rather than hitting the
        // replacement, whose index depends on how many listeners survive.
        const index = this.failTransports.length
        this.listeners.push(listener)
        let active = true
        const report = (error: FCMError): void => {
            this.transportErrors.push(error)
            if (active) {
                onError?.(error)
            }
        }
        this.failTransports[index] = report
        if (this.attachFailure !== undefined) {
            // Cordova reports a rejected keep-alive bridge synchronously, before
            // the handshake gets as far as `ready`.
            report(new FCMError('bridge_unavailable', this.attachFailure))
        }
        return () => {
            const position = this.listeners.indexOf(listener)
            if (position >= 0) {
                this.listeners.splice(position, 1)
            }
            active = false
            this.teardowns++
        }
    }

    /** Fires the transport-error callback of the Nth attach (0-based). */
    breakTransportAt(index: number, message: string): void {
        this.failTransports[index]?.(new FCMError('bridge_unavailable', message))
    }

    /** How many streams have been attached in total, including detached ones. */
    attachments(): number {
        return this.failTransports.length
    }

    breakTransport(message: string): void {
        // Cordova's keep-alive callback reports through whichever sink the most
        // recent attach installed — older ones have been detached already.
        this.failTransports[this.failTransports.length - 1]?.(
            new FCMError('bridge_unavailable', message)
        )
    }
}

const readyCore = (bridge: FakeBridge, options = {}) => {
    const core = new FCMCore(bridge, { autoInitialize: false, ...options })
    return core
}

/** Replay runs on the next microtask; tests must yield to it explicitly. */
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))

/**
 * Yields long enough for a promise chain of promise-resolved promises to run to
 * completion — recovery attaches a replacement stream through several `await`
 * hops, so a single microtask is not enough to observe its end state.
 */
const drainMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) {
        await Promise.resolve()
    }
}

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

    for (const bad of ['', ' ', 'has space', 'a'.repeat(901), '../etc', 'topic/x y']) {
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

test('topics that start with a digit are valid Firebase topic names', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    for (const topic of ['9lives', '0', '2024.updates', '~tilde', 'pct%20', 'da-sh', '_under']) {
        await core.subscribeToTopic(topic)
    }
    const subscribed = bridge.calls.filter((call) => call.action === 'subscribeToTopic')
    assert.deepEqual(
        subscribed.map((call) => call.args[0]),
        ['9lives', '0', '2024.updates', '~tilde', 'pct%20', 'da-sh', '_under']
    )
    // The documented ASCII set stops at 900 characters.
    await core.subscribeToTopic('9'.repeat(900))
    assert.equal(bridge.calls.filter((call) => call.action === 'subscribeToTopic').length, 8)
    core.dispose()
})

test('auto-init is an explicit native operation in both directions', async () => {
    const bridge = new FakeBridge()
    bridge.respond('isAutoInitEnabled', () => false)
    const core = readyCore(bridge)

    await core.setAutoInitEnabled(false)
    assert.equal(await core.isAutoInitEnabled(), false)
    await core.setAutoInitEnabled(true)
    bridge.respond('isAutoInitEnabled', () => true)
    assert.equal(await core.isAutoInitEnabled(), true)

    const autoInit = bridge.calls.filter((call) => call.action === 'setAutoInitEnabled')
    assert.deepEqual(
        autoInit.map((call) => call.args[0]),
        [false, true]
    )

    await assert.rejects(
        core.setAutoInitEnabled('yes' as never),
        (error: FCMError) => error.code === 'invalid_argument'
    )
    assert.equal(
        bridge.calls.filter((call) => call.action === 'setAutoInitEnabled').length,
        2,
        'a non-boolean must never reach the native side'
    )
    core.dispose()
})

test('a numeric native answer is still read as a boolean', async () => {
    const bridge = new FakeBridge()
    bridge.respond('hasPermission', () => 0)
    assert.equal(await readyCore(bridge).hasPermission(), false)
    bridge.respond('hasPermission', () => 1)
    assert.equal(await readyCore(bridge).hasPermission(), true)
    bridge.respond('hasPermission', () => 'false')
    assert.equal(
        await readyCore(bridge).hasPermission(),
        false,
        'the string "false" must not become truthy'
    )
})

test('a listener attached directly on the event target also gets replay', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()

    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'pre-1' } })
    bridge.emit({ kind: 'tokenRefresh', token: 'pre-token' })

    const seen: string[] = []
    core.eventTarget.addEventListener('notification', (event) => {
        seen.push(`notification:${(event as CustomEvent).detail.messageId}`)
    })
    core.eventTarget.addEventListener('tokenRefresh', (event) => {
        seen.push(`tokenRefresh:${(event as CustomEvent).detail}`)
    })
    await tick()
    assert.deepEqual(seen, ['notification:pre-1', 'tokenRefresh:pre-token'])
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
    assert.deepEqual(
        bridge.transportErrors.map((error) => error.message),
        ['event pipe broken'],
        'the core must hand the bridge a transport-error sink'
    )
    core.dispose()
})

test('a dead event stream fails initialization even when every call answers', async () => {
    const bridge = new FakeBridge()
    bridge.attachFailure = 'startJsEventBridge rejected'
    const core = readyCore(bridge)

    await assert.rejects(core.initialize(), (error: FCMError) => {
        assert.equal(error.code, 'bridge_unavailable')
        assert.match(error.message, /startJsEventBridge rejected/)
        return true
    })
    assert.deepEqual(
        bridge.calls.map((call) => call.action),
        [],
        'ready must not be asked once the event stream is known to be dead'
    )
    assert.equal(bridge.listeners.length, 0, 'the dead sink is torn down')

    // The next attempt starts from scratch instead of inheriting the rejection.
    bridge.attachFailure = undefined
    await core.initialize()
    assert.equal(bridge.listeners.length, 1, 'the retry re-attaches a sink')

    const seen: string[] = []
    core.onNotification((payload) => seen.push(String(payload.messageId)))
    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'live' } })
    assert.deepEqual(seen, ['live'], 'a retried handshake delivers live events again')
    core.dispose()
})

test('an event stream that dies after ready still fails the same handshake', async () => {
    const bridge = new FakeBridge()
    bridge.respond('ready', () => {
        bridge.breakTransport('event pipe died during handshake')
        return undefined
    })
    const core = readyCore(bridge)

    await assert.rejects(core.initialize(), (error: FCMError) => {
        assert.equal(error.code, 'bridge_unavailable')
        assert.match(error.message, /event pipe died during handshake/)
        return true
    })
    assert.deepEqual(
        bridge.calls.map((call) => call.action),
        ['ready'],
        'replay is never requested for a handshake with no working sink'
    )
    core.dispose()
})

test('a stream that dies after the handshake re-attaches instead of faking health', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()
    assert.equal(bridge.listeners.length, 1)

    // The keep-alive sink dies long after `ready` answered. Nothing in the old
    // design noticed: `initPromise` stayed fulfilled forever. Recovery is eager,
    // so the dead stream is detached and its replacement is attached before this
    // call even returns — no later API call is required to trigger it.
    bridge.breakTransport('keep-alive callback fired an error')
    assert.equal(bridge.teardowns, 1, 'the dead stream was detached exactly once')
    assert.equal(bridge.listeners.length, 1, 'a replacement stream took over immediately')

    await core.ready()
    assert.equal(bridge.listeners.length, 1, 'the settled initialization was invalidated')
    const handshakes = bridge.calls.filter((call) => call.action === 'ready').length
    assert.equal(handshakes, 2, 'recovery ran a second handshake rather than reusing the memo')

    const seen: string[] = []
    core.onNotification((payload) => seen.push(String(payload.messageId)))
    bridge.emit({
        kind: 'notification',
        payload: { wasTapped: false, messageId: 'after-recovery' }
    })
    assert.deepEqual(
        seen,
        ['after-recovery'],
        'events delivered after recovery reach the existing listeners'
    )
    core.dispose()
})

test('recovery re-attaches on its own without any later call', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()

    bridge.breakTransport('sink dropped while the app idled')
    // An app that calls no further native API must still get the next message, so
    // recovery may not wait for someone to ask.
    await drainMicrotasks()
    assert.equal(bridge.listeners.length, 1, 'the replacement sink is attached')

    const seen: string[] = []
    core.onNotification((payload) => seen.push(String(payload.messageId)))
    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'idle-recovery' } })
    assert.deepEqual(seen, ['idle-recovery'])
    core.dispose()
})

test('a native call after a late stream failure goes through a working sink', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()
    bridge.respond('getToken', () => 'token-after-recovery')

    bridge.breakTransport('sink dropped by the OS')
    // getToken awaits initialize(), so it must not resolve over a dead stream.
    const token = await core.getToken()
    assert.equal(token, 'token-after-recovery')
    assert.equal(bridge.listeners.length, 1, 'the call path reattached a sink')

    const seen: string[] = []
    core.onTokenRefresh((tokenValue) => seen.push(tokenValue))
    bridge.emit({ kind: 'tokenRefresh', token: 'pushed-after-recovery' })
    await tick()
    assert.deepEqual(seen, ['pushed-after-recovery'])
    core.dispose()
})

test('a failed recovery leaves later calls retrying instead of sticking', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()

    // Native is offline right now, so the eager reattach cannot succeed either.
    bridge.readyFail = 'native restart in progress'
    bridge.breakTransport('sink dropped')
    await drainMicrotasks()
    assert.equal(bridge.listeners.length, 0, 'the dead stream stayed detached while retry failed')

    await assert.rejects(core.getToken(), (error: FCMError) => {
        assert.equal(error.code, 'bridge_unavailable')
        return true
    })
    bridge.readyFail = undefined
    bridge.respond('getToken', () => 'token-retried')
    assert.equal(await core.getToken(), 'token-retried', 'the retry answered getToken')
    assert.equal(bridge.listeners.length, 1, 'the successful retry reattached the sink')
    core.dispose()
})

test('a stale transport callback cannot tear down a newer bridge', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()

    // Recovery detaches attach #0, but Cordova can still fire that generation's
    // error callback afterwards (the native side tears down asynchronously).
    bridge.breakTransportAt(0, 'first sink died')
    assert.equal(bridge.listeners.length, 1, 'recovery attached a replacement stream')
    const attachments = bridge.attachments()
    bridge.breakTransportAt(0, 'stale callback from the dead generation')
    await drainMicrotasks()

    assert.equal(bridge.listeners.length, 1, 'the late callback must not detach the newer bridge')
    assert.equal(bridge.teardowns, 1, 'exactly one teardown ran')
    assert.equal(attachments, bridge.attachments(), 'no extra reattach was triggered')

    const seen: string[] = []
    core.onNotification((payload) => seen.push(String(payload.messageId)))
    bridge.emit({ kind: 'notification', payload: { wasTapped: false, messageId: 'still-alive' } })
    assert.deepEqual(seen, ['still-alive'])
    core.dispose()
})

test('a transport error after dispose does not re-attach a bridge', async () => {
    const bridge = new FakeBridge()
    const core = readyCore(bridge)
    await core.initialize()
    core.dispose()
    const handshakes = bridge.calls.filter((call) => call.action === 'ready').length

    bridge.breakTransportAt(0, 'late error after dispose')
    await drainMicrotasks()

    assert.equal(bridge.listeners.length, 0, 'a disposed core has no sink')
    assert.equal(
        bridge.calls.filter((call) => call.action === 'ready').length,
        handshakes,
        'recovery never runs after dispose'
    )
})
