import assert from 'node:assert/strict'
import test from 'node:test'

import { EventBuffer, eventKey, DEFAULT_EVENT_BUFFER_SIZE } from '../src/core/eventBuffer.ts'
import type { NativeEvent } from '../src/core/types.ts'

const receipt = (id?: string, extra: Record<string, unknown> = {}): NativeEvent => ({
    kind: 'notification',
    payload: { wasTapped: false, ...(id ? { messageId: id } : {}), ...extra }
})

const tap = (id?: string): NativeEvent => ({
    kind: 'notification',
    payload: { wasTapped: true, ...(id ? { messageId: id } : {}) }
})

const token = (value: string): NativeEvent => ({ kind: 'tokenRefresh', token: value })

/** Narrows the event union for assertions. */
const payloadOf = (event: NativeEvent): Record<string, unknown> =>
    event.kind === 'notification' ? (event.payload as Record<string, unknown>) : {}

test('receipt and tap for one message id are independent events', () => {
    const buffer = new EventBuffer()

    assert.equal(buffer.offer(receipt('msg-1')), true)
    assert.equal(buffer.offer(tap('msg-1')), true, 'a tap must never be swallowed by its receipt')
    assert.equal(buffer.size, 2)

    const drained = buffer.drain()
    assert.equal(payloadOf(drained[0] as NativeEvent).wasTapped, false)
    assert.equal(payloadOf(drained[1] as NativeEvent).wasTapped, true)
})

test('exact duplicate receipts are dropped', () => {
    const buffer = new EventBuffer()
    assert.equal(buffer.offer(receipt('msg-2')), true)
    assert.equal(buffer.offer(receipt('msg-2')), false)
    assert.equal(buffer.size, 1)
})

test('id-less notifications never collapse into one another', () => {
    const buffer = new EventBuffer()
    assert.equal(buffer.offer(receipt(undefined, { n: 1 })), true)
    assert.equal(buffer.offer(receipt(undefined, { n: 2 })), true)
    assert.equal(buffer.offer(receipt(undefined, { n: 3 })), true)
    assert.equal(buffer.size, 3)
    assert.deepEqual(
        buffer.drain().map((event) => payloadOf(event).n),
        [1, 2, 3]
    )
})

test('the queue is bounded and drops the oldest events first', () => {
    const buffer = new EventBuffer(3)
    for (let i = 0; i < 6; i++) {
        buffer.offer(receipt(`m${i}`))
    }
    assert.equal(buffer.size, 3)
    assert.deepEqual(
        buffer.drain().map((event) => payloadOf(event).messageId),
        ['m3', 'm4', 'm5']
    )
    assert.equal(buffer.stats().dropped, 3)
})

test('dedup tracking itself is bounded (LRU), so memory cannot grow without limit', () => {
    const buffer = new EventBuffer(10, 2)
    buffer.offer(receipt('a'))
    buffer.offer(receipt('b'))
    buffer.offer(receipt('c')) // evicts 'a'
    assert.equal(buffer.stats().tracked, 2)
    assert.equal(
        buffer.offer(receipt('a')),
        true,
        "'a' aged out of the LRU, so it is not deduped forever"
    )
})

test('a queue limit of 0 deduplicates but never queues', () => {
    const buffer = new EventBuffer(0)
    // offer() reports whether the event was *queued*; a disabled queue always
    // reports false, so the dedup bookkeeping has to be asserted separately.
    assert.equal(buffer.offer(receipt('x')), false)
    assert.equal(buffer.size, 0)
    assert.equal(buffer.stats().queued, 0)
    assert.equal(buffer.stats().tracked, 1, 'the event is still remembered as seen')
    assert.equal(buffer.tryAccept(receipt('x')), false, 'the repeat is recognised as a duplicate')
    assert.equal(buffer.tryAccept(receipt('y')), true, 'a new event is still accepted')
    assert.equal(buffer.size, 0, 'nothing is stored even for accepted events')
})

test('draining is idempotent and order-preserving', () => {
    const buffer = new EventBuffer()
    buffer.offer(token('t-1'))
    buffer.offer(receipt('late'))
    const first = buffer.drain()
    assert.equal(first.length, 2)
    assert.equal(buffer.drain().length, 0)
})

test('token events collapse on identical value but not on distinct values', () => {
    const buffer = new EventBuffer(1)
    assert.equal(buffer.offer(token('abc')), true)
    assert.equal(buffer.offer(token('def')), true)
    assert.equal(buffer.offer(token('def')), false)
    const drained = buffer.drain()
    assert.equal(drained.length, 1)
    assert.equal((drained[0] as Extract<NativeEvent, { kind: 'tokenRefresh' }>).token, 'def')
})

test('eventKey separates the three identity spaces', () => {
    assert.equal(eventKey(receipt('m'), 'f1'), 'receipt:m')
    assert.equal(eventKey(tap('m'), 'f1'), 'tap:m')
    assert.equal(eventKey(token('t'), 'f1'), 'token:t')
    assert.notEqual(eventKey(receipt(), 'f1'), eventKey(receipt(), 'f2'))
})

test('default limits stay modest', () => {
    const buffer = new EventBuffer()
    assert.equal(DEFAULT_EVENT_BUFFER_SIZE, 20)
    buffer.offer(receipt('only'))
    assert.equal(buffer.stats().queued, 1)
})

test('stats never expose payload bodies', () => {
    const buffer = new EventBuffer()
    buffer.offer(receipt('m', { body: 'secret body', token: 'secret-token' }))
    const stats = JSON.stringify(buffer.stats())
    assert.equal(stats.includes('secret'), false)
})
