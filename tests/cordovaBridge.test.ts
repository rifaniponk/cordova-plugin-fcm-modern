import assert from 'node:assert/strict'
import test from 'node:test'

import { CordovaBridge } from '../src/bridges/cordovaBridge.ts'
import type { CordovaExecHost } from '../src/bridges/cordovaBridge.ts'
import { FCMCore } from '../src/core/fcmCore.ts'
import { FCMError } from '../src/core/errors.ts'
import type { NativeEvent } from '../src/core/types.ts'

interface ExecCall {
    service: string
    action: string
    args: unknown[]
}

/** Models the one contract Cordova actually gives a plugin: exec + keep-alive. */
class FakeCordova implements CordovaExecHost {
    public readonly platformId = 'android'
    public readonly calls: ExecCall[] = []
    public keepAlive: ((data: unknown) => void) | null = null
    public keepAliveFail: ((error: unknown) => void) | null = null
    public responders = new Map<string, (args: unknown[]) => unknown>()
    /** Models `startJsEventBridge` being rejected by the native side. */
    public startBridgeFail: string | null = null

    exec(
        success: (...args: unknown[]) => void,
        fail: (...args: unknown[]) => void,
        service: string,
        action: string,
        args: unknown[]
    ): void {
        this.calls.push({ service, action, args })
        if (action === 'startJsEventBridge') {
            this.keepAlive = success
            this.keepAliveFail = fail
            if (this.startBridgeFail !== null) {
                // Cordova reports a rejected keep-alive through its fail callback,
                // which is a channel no cordova.exec promise ever sees.
                fail(this.startBridgeFail)
            }
            return
        }
        if (action === 'stopJsEventBridge') {
            this.keepAlive = null
            this.keepAliveFail = null
            success(undefined)
            return
        }
        const responder = this.responders.get(action)
        success(responder === undefined ? undefined : responder(args))
    }

    /** Native pushes a raw keep-alive payload, exactly as Cordova delivers it. */
    push(raw: string): void {
        this.keepAlive?.(raw)
    }

    actionNames(): string[] {
        return this.calls.map((call) => call.action)
    }
}

const bridge = (cordova: FakeCordova): CordovaBridge => new CordovaBridge(cordova)

test('a raw notification envelope is parsed, flattened and dispatched', () => {
    const cordova = new FakeCordova()
    const events: NativeEvent[] = []
    const transportErrors: FCMError[] = []
    const b = bridge(cordova)
    b.addEventListener(
        (event) => events.push(event),
        (error) => transportErrors.push(error)
    )

    cordova.push(
        JSON.stringify([
            'notification',
            { wasTapped: false, messageId: 'm-1', title: 'Hi', data: { screen: 'inbox' } }
        ])
    )
    assert.deepEqual(events, [
        {
            kind: 'notification',
            payload: {
                wasTapped: false,
                messageId: 'm-1',
                title: 'Hi',
                data: { screen: 'inbox' }
            }
        }
    ])
    assert.equal(transportErrors.length, 0)
})

test('a tokenRefresh keep-alive value is a plain string', () => {
    const cordova = new FakeCordova()
    const events: NativeEvent[] = []
    bridge(cordova).addEventListener((event) => events.push(event))
    cordova.push(JSON.stringify(['tokenRefresh', 'raw-token']))
    assert.deepEqual(events, [{ kind: 'tokenRefresh', token: 'raw-token' }])
})

test('malformed native JSON is reported, never guessed at', () => {
    const cordova = new FakeCordova()
    const events: NativeEvent[] = []
    const transportErrors: FCMError[] = []
    bridge(cordova).addEventListener(
        (event) => events.push(event),
        (error) => transportErrors.push(error)
    )
    cordova.push('{"not":"a tuple"}')
    cordova.push('')
    cordova.push('nonsense')
    cordova.push(JSON.stringify(['unknownEvent', {}]))
    cordova.push(JSON.stringify(['tokenRefresh', 42]))
    assert.equal(events.length, 0, 'no phantom event may be invented from junk')
    assert.equal(transportErrors.length, 4, 'junk and broken envelopes are reported')
    assert.equal(transportErrors[0]?.code, 'native_error')
    assert.deepEqual(
        transportErrors.map((error) => error.code),
        ['native_error', 'native_error', 'native_error', 'native_error']
    )
})

test('an unknown event name from a newer native core is ignored, not fatal', () => {
    const cordova = new FakeCordova()
    const events: NativeEvent[] = []
    const transportErrors: FCMError[] = []
    bridge(cordova).addEventListener(
        (event) => events.push(event),
        (error) => transportErrors.push(error)
    )
    cordova.push(JSON.stringify(['someFutureEvent', { a: 1 }]))
    cordova.push(JSON.stringify(['tokenRefresh', 'still-alive']))
    assert.deepEqual(events, [{ kind: 'tokenRefresh', token: 'still-alive' }])
    assert.deepEqual(transportErrors, [])
})

test('non-string keep-alive deliveries are ignored', () => {
    const cordova = new FakeCordova()
    const events: NativeEvent[] = []
    const transportErrors: FCMError[] = []
    bridge(cordova).addEventListener(
        (event) => events.push(event),
        (error) => transportErrors.push(error)
    )
    cordova.keepAlive?.({ wasTapped: false })
    cordova.keepAlive?.(undefined)
    assert.deepEqual(events, [])
    assert.deepEqual(transportErrors, [])
})

test('teardown disposes the sink and releases the native keep-alive', () => {
    const cordova = new FakeCordova()
    const events: NativeEvent[] = []
    const teardown = bridge(cordova).addEventListener((event) => events.push(event))
    assert.ok(cordova.keepAlive, 'startJsEventBridge installed a keep-alive callback')

    teardown()
    assert.deepEqual(cordova.actionNames(), ['startJsEventBridge', 'stopJsEventBridge'])
    assert.equal(cordova.keepAlive, null)

    cordova.push(JSON.stringify(['tokenRefresh', 'after']))
    assert.deepEqual(events, [], 'a disposed sink must not receive anything')
    teardown()
    assert.equal(
        cordova.actionNames().filter((action) => action === 'stopJsEventBridge').length,
        1,
        'teardown is idempotent'
    )
})

test('a second concurrent attach does not install a second keep-alive', () => {
    const cordova = new FakeCordova()
    const first = bridge(cordova)
    first.addEventListener(() => undefined)
    first.addEventListener(() => undefined)
    assert.equal(cordova.actionNames().filter((a) => a === 'startJsEventBridge').length, 1)
})

test('the native failure callback kills the sink and reports a transport error', () => {
    const cordova = new FakeCordova()
    const events: NativeEvent[] = []
    const transportErrors: FCMError[] = []
    const b = bridge(cordova)
    b.addEventListener(
        (event) => events.push(event),
        (error) => transportErrors.push(error)
    )
    cordova.keepAliveFail?.('native service died')
    cordova.push(JSON.stringify(['tokenRefresh', 'late']))
    assert.deepEqual(events, [])
    assert.equal(transportErrors.length, 1)
    assert.equal(transportErrors[0]?.code, 'bridge_unavailable')

    // Re-attaching after a dead bridge must install a fresh keep-alive.
    b.addEventListener(() => undefined)
    assert.equal(cordova.actionNames().filter((a) => a === 'startJsEventBridge').length, 2)
})

test('calls use the FCMPlugin service and reject without a host', async () => {
    const cordova = new FakeCordova()
    cordova.responders.set('getToken', () => 'native-token')
    assert.equal(await bridge(cordova).call<string>('getToken'), 'native-token')
    assert.deepEqual(cordova.calls[0], { service: 'FCMPlugin', action: 'getToken', args: [] })

    const missing = new CordovaBridge(null)
    await assert.rejects(
        missing.call('getToken'),
        (error: FCMError) => error.code === 'bridge_unavailable'
    )
})

test('the bridge reports the platform Cordova is running on', () => {
    assert.equal(bridge(new FakeCordova()).platformId, 'android')
    assert.equal(new CordovaBridge(null).platformId, 'unknown')
})

test('a cold start flows end to end: raw envelope, buffer, replay, sanitising', async () => {
    const cordova = new FakeCordova()
    const core = new FCMCore(new CordovaBridge(cordova), { autoInitialize: false })
    await core.initialize()
    assert.deepEqual(cordova.actionNames(), ['startJsEventBridge', 'ready', 'replayBufferedEvents'])

    // Native fires before any JS listener exists — the whole point of the buffer.
    cordova.push(
        JSON.stringify([
            'notification',
            { wasTapped: false, messageId: 'cold', title: 'Queued', data: { wasTapped: true } }
        ])
    )
    const seen: Array<Record<string, unknown>> = []
    core.onNotification((payload) => seen.push({ ...payload }))
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    assert.equal(seen.length, 1)
    assert.equal(seen[0]?.wasTapped, false, 'the remote data cannot spoof a tap into a receipt')
    assert.deepEqual(seen[0]?.custom, { wasTapped: true })
    assert.deepEqual(seen[0]?._fcm, { collisions: ['wasTapped'] })
    core.dispose()
})

test('a rejected keep-alive start fails initialization instead of faking readiness', async () => {
    const cordova = new FakeCordova()
    cordova.startBridgeFail = 'FCMPlugin: event bridge not permitted'
    const core = new FCMCore(new CordovaBridge(cordova), { autoInitialize: false })

    await assert.rejects(
        core.initialize(),
        (error: FCMError) => {
            assert.equal(error.code, 'bridge_unavailable')
            assert.match(error.message, /event bridge not permitted/)
            return true
        },
        'the keep-alive failure channel must reach the caller that awaited initialize()'
    )
    assert.deepEqual(
        cordova.actionNames(),
        ['startJsEventBridge'],
        'ready and replay are never requested for a handshake with no sink'
    )

    // A retry after the native side recovers installs a fresh keep-alive.
    cordova.startBridgeFail = null
    await core.initialize()
    assert.deepEqual(
        cordova.actionNames(),
        ['startJsEventBridge', 'startJsEventBridge', 'ready', 'replayBufferedEvents'],
        'the retry re-attaches the sink instead of reusing the dead one'
    )
    const seen: string[] = []
    core.onNotification((payload) => seen.push(String(payload.messageId)))
    cordova.push(JSON.stringify(['notification', { wasTapped: false, messageId: 'after-retry' }]))
    assert.deepEqual(seen, ['after-retry'])
    core.dispose()
})

test('an event stream that dies while ready succeeds still fails the handshake', async () => {
    const cordova = new FakeCordova()
    cordova.responders.set('ready', () => {
        cordova.keepAliveFail?.('native service died mid-handshake')
        return undefined
    })
    const core = new FCMCore(new CordovaBridge(cordova), { autoInitialize: false })

    await assert.rejects(core.initialize(), (error: FCMError) => {
        assert.equal(error.code, 'bridge_unavailable')
        assert.match(error.message, /native service died/)
        return true
    })
    assert.deepEqual(
        cordova.actionNames(),
        ['startJsEventBridge', 'ready'],
        'a sink that died before replay must not be treated as initialised'
    )
    core.dispose()
})
