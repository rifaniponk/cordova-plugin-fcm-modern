import assert from 'node:assert/strict'
import test from 'node:test'

import { CapacitorBridge } from '../src/bridges/capacitorBridge.ts'
import { FCMCore } from '../src/core/fcmCore.ts'
import { FCMError } from '../src/core/errors.ts'
import type { FCMListenerHandle, FCMNativeContract } from '../src/capacitor/contract.ts'
import type { NativeEvent } from '../src/core/types.ts'

interface Recorded {
    method: string
    args: unknown[]
}

/**
 * Fake of a Capacitor-registered native plugin. `addListener` is deliberately
 * asynchronous, like the real generated proxy, and every handle records how many
 * times `remove()` ran.
 */
class FakePlugin {
    public readonly calls: Recorded[] = []
    public readonly removals = new Map<FCMListenerHandle, number>()
    public readonly order: string[] = []
    public listeners = new Map<string, (payload: never) => void>()
    public registrationDelayMs = 0
    public registerImpl: ((event: string) => Promise<FCMListenerHandle>) | undefined

    private record(method: string, args: unknown[]): void {
        this.calls.push({ method, args })
        this.order.push(method)
    }

    public emit(event: string, payload: unknown): void {
        this.listeners.get(event)?.(payload as never)
    }

    removalCount(handle: FCMListenerHandle): number {
        return this.removals.get(handle) ?? 0
    }

    asContract(): FCMNativeContract {
        const self = this
        const handle = (): FCMListenerHandle => {
            const created: FCMListenerHandle = {
                remove: () => {
                    self.removals.set(created, self.removalCount(created) + 1)
                    return Promise.resolve()
                }
            }
            return created
        }
        const plugin = {
            ready: async () => self.record('ready', []),
            replayBufferedEvents: async () => self.record('replayBufferedEvents', []),
            setForegroundPresentation: async (options: unknown) =>
                self.record('setForegroundPresentation', [options]),
            getToken: async () => {
                self.record('getToken', [])
                return { value: 'cap-token' }
            },
            deleteToken: async () => self.record('deleteToken', []),
            getAPNSToken: async () => {
                self.record('getAPNSToken', [])
                return { value: 'apns' }
            },
            getInitialPushPayload: async () => {
                self.record('getInitialPushPayload', [])
                return { payload: { wasTapped: true, messageId: 'startup' } }
            },
            hasPermission: async () => {
                self.record('hasPermission', [])
                return { value: true }
            },
            requestPushPermission: async (options: unknown) => {
                self.record('requestPushPermission', [options])
                return { value: true }
            },
            subscribeToTopic: async (options: unknown) =>
                self.record('subscribeToTopic', [options]),
            unsubscribeFromTopic: async (options: unknown) =>
                self.record('unsubscribeFromTopic', [options]),
            clearAllNotifications: async () => self.record('clearAllNotifications', []),
            createNotificationChannel: async (channel: unknown) =>
                self.record('createNotificationChannel', [channel]),
            setAutoInitEnabled: async (options: unknown) =>
                self.record('setAutoInitEnabled', [options]),
            isAutoInitEnabled: async () => {
                self.record('isAutoInitEnabled', [])
                return { value: false }
            },
            addListener: (event: string, listenerFunc: (payload: never) => void) => {
                self.record('addListener', [event])
                self.listeners.set(event, listenerFunc)
                const register = self.registerImpl
                if (register !== undefined) {
                    return register(event)
                }
                return new Promise<FCMListenerHandle>((resolve) => {
                    setTimeout(() => {
                        self.order.push(`addListener:${event}:settled`)
                        resolve(handle())
                    }, self.registrationDelayMs)
                })
            }
        }
        return plugin as unknown as FCMNativeContract
    }
}

const bridgeFor = (plugin: FakePlugin): CapacitorBridge =>
    new CapacitorBridge(plugin.asContract(), 'android')

test('Capacitor topic inputs are objects, never bare strings', async () => {
    const plugin = new FakePlugin()
    const bridge = bridgeFor(plugin)
    await bridge.call('subscribeToTopic', ['orders'])
    await bridge.call('unsubscribeFromTopic', ['orders'])
    assert.deepEqual(plugin.calls[0], { method: 'subscribeToTopic', args: [{ topic: 'orders' }] })
    assert.deepEqual(plugin.calls[1], {
        method: 'unsubscribeFromTopic',
        args: [{ topic: 'orders' }]
    })
})

test('auto-init crosses the Capacitor wire as {enabled}', async () => {
    const plugin = new FakePlugin()
    const bridge = bridgeFor(plugin)
    await bridge.call('setAutoInitEnabled', [true])
    assert.equal(await bridge.call<unknown>('isAutoInitEnabled'), false)
    assert.deepEqual(plugin.calls[0], { method: 'setAutoInitEnabled', args: [{ enabled: true }] })
})

test('a missing required native method rejects instead of resolving undefined', async () => {
    const plugin = new FakePlugin()
    const contract = plugin.asContract() as unknown as Record<string, unknown>
    delete contract['getToken']
    delete contract['subscribeToTopic']
    const bridge = new CapacitorBridge(contract as never, 'android')

    await assert.rejects(bridge.call('getToken'), (error: FCMError) => {
        assert.equal(error.code, 'bridge_unavailable')
        assert.match(error.message, /does not implement "getToken"/)
        return true
    })
    await assert.rejects(
        bridge.call('subscribeToTopic', ['orders']),
        (error: FCMError) => error.code === 'bridge_unavailable'
    )
})

test('values are unwrapped from { value } and { payload }', async () => {
    const plugin = new FakePlugin()
    const bridge = bridgeFor(plugin)
    assert.equal(await bridge.call<string>('getToken'), 'cap-token')
    assert.equal(await bridge.call<boolean>('hasPermission'), true)
    assert.deepEqual(await bridge.call<unknown>('getInitialPushPayload'), {
        wasTapped: true,
        messageId: 'startup'
    })
})

test('registration is awaited before ready and replay', async () => {
    const plugin = new FakePlugin()
    plugin.registrationDelayMs = 5
    const bridge = bridgeFor(plugin)
    const core = new FCMCore(bridge, { autoInitialize: false })
    await core.initialize()
    assert.deepEqual(
        plugin.order,
        [
            'addListener',
            'addListener',
            'addListener:notification:settled',
            'addListener:tokenRefresh:settled',
            'ready',
            'replayBufferedEvents'
        ],
        'a cold-start burst emitted while addListener is in flight would be lost'
    )
    core.dispose()
})

test('a failed listener registration fails the handshake instead of going unnoticed', async () => {
    const plugin = new FakePlugin()
    plugin.registerImpl = () => Promise.reject(new Error('native listener refused'))
    const bridge = bridgeFor(plugin)
    const core = new FCMCore(bridge, { autoInitialize: false })
    await assert.rejects(core.initialize(), (error: FCMError) => {
        assert.equal(error.code, 'bridge_unavailable')
        assert.match(error.message, /native listener refused/)
        return true
    })
    assert.deepEqual(plugin.order, ['addListener', 'addListener'])
    core.dispose()
})

test('events reach the core, including a tokenRefresh payload', async () => {
    const plugin = new FakePlugin()
    const bridge = bridgeFor(plugin)
    const core = new FCMCore(bridge, { autoInitialize: false })
    await core.initialize()
    const seen: NativeEvent[] = []
    core.onNotification((payload) => seen.push({ kind: 'notification', payload }))
    core.onTokenRefresh((token) => seen.push({ kind: 'tokenRefresh', token }))

    plugin.emit('notification', { wasTapped: false, messageId: 'cap-1', data: { tag: 'x' } })
    plugin.emit('tokenRefresh', { token: 'cap-token-2' })
    assert.deepEqual(seen, [
        { kind: 'notification', payload: { wasTapped: false, messageId: 'cap-1', tag: 'x' } },
        { kind: 'tokenRefresh', token: 'cap-token-2' }
    ])
    core.dispose()
})

test('teardown of a registration that lands late removes the handle exactly once', async () => {
    const plugin = new FakePlugin()
    let settle: ((handle: FCMListenerHandle) => void) | undefined
    let settleCount = 0
    plugin.registerImpl = () =>
        new Promise<FCMListenerHandle>((resolve) => {
            settle = (handle) => {
                settleCount++
                resolve(handle)
            }
        })
    const bridge = bridgeFor(plugin)
    const teardown = bridge.addEventListener(() => undefined)
    teardown()

    // The registration completes *after* disposal: the handle must be removed,
    // but only once, and never by two competing teardown paths.
    let removals = 0
    const late: FCMListenerHandle = {
        remove: () => {
            removals++
            return Promise.resolve()
        }
    }
    settle?.(late)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    assert.equal(settleCount, 1, 'the late registration settled once')
    assert.equal(removals, 1, 'the late handle is removed exactly once')
})

test('handles registered before teardown are removed exactly once', async () => {
    const plugin = new FakePlugin()
    const bridge = bridgeFor(plugin)
    const teardown = bridge.addEventListener(() => undefined)
    await bridge.waitForEventRegistration()
    teardown()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    teardown()
    const counts = [...plugin.removals.values()]
    assert.equal(counts.length, 2, 'two handles were registered')
    assert.deepEqual(counts, [1, 1], 'each handle is removed once, even on repeated teardown')
})
