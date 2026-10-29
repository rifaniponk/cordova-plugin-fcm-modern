import type { INotificationPayload, NativeEvent } from './types.js'

export type EventSpace = 'receipt' | 'tap' | 'token'

export const DEFAULT_EVENT_BUFFER_SIZE = 20
export const DEFAULT_DEDUP_CACHE_SIZE = 100

/**
 * Dedup key for an event. Receipts and taps are separate identity spaces, so a
 * tap never disappears because the receipt of the same message was seen first.
 * Messages without an id are never deduplicated: there is no way to prove two
 * id-less messages are the same one, and collapsing them would lose deliveries.
 */
export const eventKey = (event: NativeEvent, fallback: string): string | null => {
    if (event.kind === 'tokenRefresh') {
        return `token:${event.token}`
    }
    const payload = event.payload
    const space: EventSpace = payload.wasTapped === true ? 'tap' : 'receipt'
    const id = payload.messageId
    if (typeof id === 'string' && id.length > 0) {
        return `${space}:${id}`
    }
    return `${space}:anon:${fallback}`
}

interface BufferState {
    /** Events waiting for a listener; cleared once the first one attaches. */
    queue: NativeEvent[]
    /** Recently delivered keys, per identity space. */
    seen: Set<string>
    order: string[]
}

/**
 * Bounded event store shared by every runtime. It is deliberately independent of
 * the bridge so a native replay burst can never grow memory without limit.
 */
export class EventBuffer {
    private readonly state: BufferState = { queue: [], seen: new Set(), order: [] }
    private anonymousCounter = 0

    private readonly queueLimit: number
    private readonly dedupLimit: number

    constructor(
        queueLimit: number = DEFAULT_EVENT_BUFFER_SIZE,
        dedupLimit: number = DEFAULT_DEDUP_CACHE_SIZE
    ) {
        this.queueLimit = queueLimit
        this.dedupLimit = dedupLimit
        if (queueLimit < 0 || dedupLimit < 0) {
            throw new RangeError('event buffer limits must not be negative')
        }
    }

    get size(): number {
        return this.state.queue.length
    }

    get droppedCount(): number {
        return this.dropped
    }

    private dropped = 0

    /**
     * Records the event as seen and reports whether it is new. This is the dedup
     * gate for the live path; `offer()` additionally queues it for replay.
     */
    tryAccept(event: NativeEvent): boolean {
        const key = eventKey(event, `n${this.anonymousCounter++}`)
        if (key === null) {
            return true
        }
        if (this.state.seen.has(key)) {
            return false
        }
        this.remember(key)
        return true
    }

    /**
     * Appends to the replay queue, dropping the oldest entry when full.
     * @returns whether the event was actually queued (false when the queue is disabled).
     */
    enqueue(event: NativeEvent): boolean {
        if (this.queueLimit === 0) {
            return false
        }
        this.state.queue.push(event)
        if (this.state.queue.length > this.queueLimit) {
            this.state.queue.shift()
            this.dropped++
        }
        return true
    }

    /**
     * Dedup + queue in one step. Dedup bookkeeping runs even when the queue is
     * disabled, so a limit-0 buffer still collapses repeats without storing them.
     * @returns false when the event was a duplicate or could not be queued.
     */
    offer(event: NativeEvent): boolean {
        if (!this.tryAccept(event)) {
            return false
        }
        return this.enqueue(event)
    }

    markDelivered(event: NativeEvent): void {
        this.tryAccept(event)
    }

    /** Pops the oldest queued event, or undefined when the queue is empty. */
    next(): NativeEvent | undefined {
        return this.state.queue.shift()
    }

    /** Drains the queue in arrival order. */
    drain(): NativeEvent[] {
        const events = this.state.queue
        this.state.queue = []
        return events
    }

    private remember(key: string): void {
        if (this.dedupLimit === 0) {
            return
        }
        this.state.seen.add(key)
        this.state.order.push(key)
        while (this.state.order.length > this.dedupLimit) {
            const oldest = this.state.order.shift()
            if (oldest !== undefined) {
                this.state.seen.delete(oldest)
            }
        }
    }

    /** Test/diagnostic helper: never contains payload bodies. */
    stats(): { queued: number; tracked: number; dropped: number } {
        return {
            queued: this.state.queue.length,
            tracked: this.state.seen.size,
            dropped: this.dropped
        }
    }
}

export const isNotificationEvent = (
    event: NativeEvent
): event is Extract<NativeEvent, { kind: 'notification' }> => event.kind === 'notification'

export const payloadOf = (event: NativeEvent): INotificationPayload | undefined =>
    event.kind === 'notification' ? event.payload : undefined
