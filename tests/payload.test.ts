import assert from 'node:assert/strict'
import test from 'node:test'

import {
    sanitizeNotificationPayload,
    extractMessageId,
    RESERVED_KEYS
} from '../src/core/payload.ts'

test('flattens user data while keeping trusted metadata intact', () => {
    const payload = sanitizeNotificationPayload({
        wasTapped: false,
        messageId: '1789',
        title: 'Trip update',
        body: 'Your ride is 3 minutes away',
        data: { orderId: 'A-1', deepLink: '/orders/A-1' }
    })

    assert.ok(payload)
    assert.equal(payload.wasTapped, false)
    assert.equal(payload.messageId, '1789')
    assert.equal(payload.title, 'Trip update')
    assert.equal(payload.orderId, 'A-1')
    assert.equal(payload.deepLink, '/orders/A-1')
    assert.equal(payload.custom, undefined)
})

test('message data cannot spoof wasTapped, the message id or _fcm metadata', () => {
    const payload = sanitizeNotificationPayload({
        wasTapped: true,
        messageId: 'real-id',
        data: {
            wasTapped: false,
            messageId: 'spoofed',
            title: 'spoofed title',
            _fcm: { collisions: ['forged'] },
            badge: 99,
            legit: 'kept'
        }
    })

    assert.ok(payload)
    assert.equal(payload.wasTapped, true, 'tap state must come from the native layer')
    assert.equal(payload.messageId, 'real-id')
    assert.equal(payload.title, undefined, 'no trusted title existed')
    assert.equal(payload.badge, undefined)
    assert.equal(payload.legit, 'kept')
    assert.deepEqual(payload.custom, {
        wasTapped: false,
        messageId: 'spoofed',
        title: 'spoofed title',
        _fcm: { collisions: ['forged'] },
        badge: 99
    })
    assert.deepEqual((payload._fcm as { collisions: string[] }).collisions.sort(), [
        '_fcm',
        'badge',
        'messageId',
        'title',
        'wasTapped'
    ])
})

test('prototype-sensitive keys are dropped and recorded, never assigned', () => {
    const hostile = JSON.parse(
        '{"wasTapped":false,"data":{"__proto__":{"polluted":true},"constructor":"x","prototype":"y","ok":"kept"}}'
    )
    const payload = sanitizeNotificationPayload(hostile)

    assert.ok(payload)
    assert.equal(payload.ok, 'kept')
    assert.equal(
        Object.getPrototypeOf(payload),
        Object.prototype,
        'the payload keeps a normal prototype'
    )
    assert.equal(Object.prototype.hasOwnProperty.call(payload, '__proto__'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'polluted'), false)
    assert.equal(
        ({} as Record<string, unknown>).polluted,
        undefined,
        'Object.prototype must stay clean'
    )
    assert.deepEqual((payload._fcm as { dropped: string[] }).dropped, [
        '__proto__',
        'constructor',
        'prototype'
    ])
})

test('legacy flattened payloads still produce the canonical shape', () => {
    const payload = sanitizeNotificationPayload({
        wasTapped: false,
        title: 'Legacy',
        body: 'body',
        customKey: 'value',
        gcm: { message_id: 'legacy-id' }
    })

    assert.ok(payload)
    assert.equal(payload.messageId, 'legacy-id')
    assert.equal(payload.title, 'Legacy')
    assert.equal(payload.customKey, 'value')
})

test('a legacy key that collides with metadata is preserved under custom', () => {
    const payload = sanitizeNotificationPayload({ wasTapped: false, title: 'trusted', body: 'b' })
    assert.ok(payload)
    assert.equal(payload.title, 'trusted')
    // A sender-supplied `title` in the flattened form is indistinguishable from the
    // notification title, so the trusted one wins and nothing is silently lost.
    const withCollision = sanitizeNotificationPayload({
        wasTapped: false,
        title: 'trusted',
        data: { title: 'from data' }
    })
    assert.ok(withCollision)
    assert.equal(withCollision.title, 'trusted')
    assert.deepEqual(withCollision.custom, { title: 'from data' })
})

test('messages without an id keep independent identity', () => {
    const first = sanitizeNotificationPayload({ wasTapped: false, data: { n: 1 } })
    const second = sanitizeNotificationPayload({ wasTapped: false, data: { n: 2 } })

    assert.ok(first && second)
    assert.equal(first.messageId, undefined)
    assert.equal(second.messageId, undefined)
    assert.equal(extractMessageId({ n: 1 } as never), undefined)
})

test('non-object input is rejected instead of becoming a phantom notification', () => {
    assert.equal(sanitizeNotificationPayload(null), null)
    assert.equal(sanitizeNotificationPayload('payload'), null)
    assert.equal(sanitizeNotificationPayload(['a']), null)
    assert.equal(sanitizeNotificationPayload(undefined), null)
})

test('reserved key list covers the fields dedup and presentation rely on', () => {
    assert.deepEqual(
        [...RESERVED_KEYS].sort(),
        ['_fcm', 'badge', 'body', 'custom', 'messageId', 'subtitle', 'title', 'wasTapped'].sort()
    )
})

test('badge and numeric ids are normalised to numbers and strings', () => {
    const payload = sanitizeNotificationPayload({ wasTapped: false, badge: '7', messageId: 12345 })
    assert.ok(payload)
    assert.equal(payload.badge, 7)
    assert.equal(payload.messageId, '12345')
})
