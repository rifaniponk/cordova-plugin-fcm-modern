import assert from 'node:assert/strict'
import test from 'node:test'

import {
    CountingEventTarget,
    NOTIFICATION_EVENT,
    TOKEN_REFRESH_EVENT
} from '../src/core/eventTarget.ts'

const fire = (target: CountingEventTarget, type: string, detail?: unknown): void => {
    target.dispatchEvent(new CustomEvent(type, { detail }))
}

test('an identical listener registration is counted once, like the spec stores it', () => {
    const target = new CountingEventTarget()
    const listener = (): void => undefined
    target.addEventListener(NOTIFICATION_EVENT, listener)
    target.addEventListener(NOTIFICATION_EVENT, listener)
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 1)

    target.removeEventListener(NOTIFICATION_EVENT, listener)
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 0)
    target.removeEventListener(NOTIFICATION_EVENT, listener)
    assert.equal(
        target.subscriberCount(NOTIFICATION_EVENT),
        0,
        'a second removal cannot go negative'
    )
})

test('capture and non-capture registrations are separate subscribers', () => {
    const target = new CountingEventTarget()
    const listener = (): void => undefined
    target.addEventListener(NOTIFICATION_EVENT, listener, true)
    target.addEventListener(NOTIFICATION_EVENT, listener, false)
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 2)
    target.removeEventListener(NOTIFICATION_EVENT, listener, true)
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 1)
})

test('a null listener is not a subscriber', () => {
    const target = new CountingEventTarget()
    target.addEventListener(NOTIFICATION_EVENT, null)
    target.addEventListener(NOTIFICATION_EVENT, null)
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 0)
})

test('a once listener leaves the count when it has fired', () => {
    const target = new CountingEventTarget()
    let calls = 0
    target.addEventListener(
        TOKEN_REFRESH_EVENT,
        () => {
            calls++
        },
        { once: true }
    )
    assert.equal(target.subscriberCount(TOKEN_REFRESH_EVENT), 1)

    fire(target, TOKEN_REFRESH_EVENT, 'tok')
    assert.equal(calls, 1)
    assert.equal(
        target.subscriberCount(TOKEN_REFRESH_EVENT),
        0,
        'the mirror must follow the real list'
    )

    fire(target, TOKEN_REFRESH_EVENT, 'tok')
    assert.equal(calls, 1, 'a once listener must not fire twice')
})

test('a once listener that registers another listener cannot evict it', () => {
    const target = new CountingEventTarget()
    const calls: string[] = []
    const added = (): void => {
        calls.push('added')
    }
    const first = (): void => {
        calls.push('first')
        // Registered *during* this dispatch: it was never invoked, so cleaning up
        // the fired registration must not drop it from the real list or the count.
        target.addEventListener(TOKEN_REFRESH_EVENT, added, { once: true })
    }
    target.addEventListener(TOKEN_REFRESH_EVENT, first, { once: true })
    assert.equal(target.subscriberCount(TOKEN_REFRESH_EVENT), 1)

    fire(target, TOKEN_REFRESH_EVENT, 'tok')

    assert.deepEqual(calls, ['first'])
    assert.equal(
        target.subscriberCount(TOKEN_REFRESH_EVENT),
        1,
        'only the registration that fired may leave the count'
    )

    fire(target, TOKEN_REFRESH_EVENT, 'tok2')
    assert.deepEqual(calls, ['first', 'added'])
    assert.equal(target.subscriberCount(TOKEN_REFRESH_EVENT), 0)
})

test('a once listener skipped by stopImmediatePropagation stays subscribed', () => {
    const target = new CountingEventTarget()
    const calls: string[] = []
    target.addEventListener(
        NOTIFICATION_EVENT,
        (event) => {
            calls.push('first')
            event.stopImmediatePropagation()
        },
        { once: true }
    )
    target.addEventListener(
        NOTIFICATION_EVENT,
        () => {
            calls.push('second')
        },
        { once: true }
    )
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 2)

    fire(target, NOTIFICATION_EVENT)
    assert.deepEqual(calls, ['first'])
    assert.equal(
        target.subscriberCount(NOTIFICATION_EVENT),
        1,
        'the skipped sibling never fired, so it must still be counted'
    )

    fire(target, NOTIFICATION_EVENT)
    assert.deepEqual(calls, ['first', 'second'])
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 0)
})

test('removing a once listener after it fired cannot drive the count negative', () => {
    const target = new CountingEventTarget()
    const listener = (): void => undefined
    target.addEventListener(NOTIFICATION_EVENT, listener, { once: true })
    fire(target, NOTIFICATION_EVENT)
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 0)
    target.removeEventListener(NOTIFICATION_EVENT, listener)
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 0)
})

test('an AbortSignal removal decrements the count', () => {
    const target = new CountingEventTarget()
    const controller = new AbortController()
    let calls = 0
    target.addEventListener(
        NOTIFICATION_EVENT,
        () => {
            calls++
        },
        { signal: controller.signal }
    )
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 1)

    controller.abort()
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 0)
    fire(target, NOTIFICATION_EVENT)
    assert.equal(calls, 0)
})

test('an already-aborted signal never becomes a subscriber', () => {
    const target = new CountingEventTarget()
    const controller = new AbortController()
    controller.abort()
    target.addEventListener(NOTIFICATION_EVENT, () => undefined, { signal: controller.signal })
    assert.equal(
        target.subscriberCount(NOTIFICATION_EVENT),
        0,
        'counting it would make the core deliver live to nobody'
    )
})

test('event names outside the plugin contract are not tracked', () => {
    const target = new CountingEventTarget()
    target.addEventListener('some-app-event', () => undefined)
    assert.equal(target.subscriberCount('some-app-event'), 0)
})

test('a subscription callback lets the core replay to raw eventTarget listeners', () => {
    const target = new CountingEventTarget()
    const seen: string[] = []
    const notification = (): void => undefined
    const token = (): void => undefined
    target.setOnSubscribe((type) => seen.push(type))
    target.addEventListener(NOTIFICATION_EVENT, notification)
    // The same (listener, capture) pair, so the real target stores it once and the
    // mirror must not raise a second subscriber — that would trigger a replay the
    // app never asked for.
    target.addEventListener(NOTIFICATION_EVENT, notification)
    target.addEventListener(TOKEN_REFRESH_EVENT, token)
    target.removeEventListener('some-app-event', notification)
    target.removeEventListener(NOTIFICATION_EVENT, () => undefined)
    target.removeEventListener(TOKEN_REFRESH_EVENT, token)
    assert.deepEqual(
        seen,
        [NOTIFICATION_EVENT, TOKEN_REFRESH_EVENT],
        'only real increases may trigger a replay'
    )
    assert.equal(target.subscriberCount(NOTIFICATION_EVENT), 1)
    assert.equal(target.subscriberCount(TOKEN_REFRESH_EVENT), 0)
})
