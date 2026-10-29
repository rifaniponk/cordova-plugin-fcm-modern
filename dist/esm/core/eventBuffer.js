export const DEFAULT_EVENT_BUFFER_SIZE = 20;
export const DEFAULT_DEDUP_CACHE_SIZE = 100;
/**
 * Dedup key for an event. Receipts and taps are separate identity spaces, so a
 * tap never disappears because the receipt of the same message was seen first.
 * Messages without an id are never deduplicated: there is no way to prove two
 * id-less messages are the same one, and collapsing them would lose deliveries.
 */
export const eventKey = (event, fallback) => {
    if (event.kind === 'tokenRefresh') {
        return `token:${event.token}`;
    }
    const payload = event.payload;
    const space = payload.wasTapped === true ? 'tap' : 'receipt';
    const id = payload.messageId;
    if (typeof id === 'string' && id.length > 0) {
        return `${space}:${id}`;
    }
    return `${space}:anon:${fallback}`;
};
/**
 * Bounded event store shared by every runtime. It is deliberately independent of
 * the bridge so a native replay burst can never grow memory without limit.
 */
export class EventBuffer {
    state = { queue: [], seen: new Set(), order: [] };
    anonymousCounter = 0;
    queueLimit;
    dedupLimit;
    constructor(queueLimit = DEFAULT_EVENT_BUFFER_SIZE, dedupLimit = DEFAULT_DEDUP_CACHE_SIZE) {
        this.queueLimit = queueLimit;
        this.dedupLimit = dedupLimit;
        if (queueLimit < 0 || dedupLimit < 0) {
            throw new RangeError('event buffer limits must not be negative');
        }
    }
    get size() {
        return this.state.queue.length;
    }
    get droppedCount() {
        return this.dropped;
    }
    dropped = 0;
    /**
     * Records the event as seen and reports whether it is new. This is the dedup
     * gate for the live path; `offer()` additionally queues it for replay.
     */
    tryAccept(event) {
        const key = eventKey(event, `n${this.anonymousCounter++}`);
        if (key === null) {
            return true;
        }
        if (this.state.seen.has(key)) {
            return false;
        }
        this.remember(key);
        return true;
    }
    /**
     * Appends to the replay queue, dropping the oldest entry when full.
     * @returns whether the event was actually queued (false when the queue is disabled).
     */
    enqueue(event) {
        if (this.queueLimit === 0) {
            return false;
        }
        this.state.queue.push(event);
        if (this.state.queue.length > this.queueLimit) {
            this.state.queue.shift();
            this.dropped++;
        }
        return true;
    }
    /**
     * Dedup + queue in one step. Dedup bookkeeping runs even when the queue is
     * disabled, so a limit-0 buffer still collapses repeats without storing them.
     * @returns false when the event was a duplicate or could not be queued.
     */
    offer(event) {
        if (!this.tryAccept(event)) {
            return false;
        }
        return this.enqueue(event);
    }
    markDelivered(event) {
        this.tryAccept(event);
    }
    /** Pops the oldest queued event, or undefined when the queue is empty. */
    next() {
        return this.state.queue.shift();
    }
    /** Drains the queue in arrival order. */
    drain() {
        const events = this.state.queue;
        this.state.queue = [];
        return events;
    }
    remember(key) {
        if (this.dedupLimit === 0) {
            return;
        }
        this.state.seen.add(key);
        this.state.order.push(key);
        while (this.state.order.length > this.dedupLimit) {
            const oldest = this.state.order.shift();
            if (oldest !== undefined) {
                this.state.seen.delete(oldest);
            }
        }
    }
    /** Test/diagnostic helper: never contains payload bodies. */
    stats() {
        return {
            queued: this.state.queue.length,
            tracked: this.state.seen.size,
            dropped: this.dropped
        };
    }
}
export const isNotificationEvent = (event) => event.kind === 'notification';
export const payloadOf = (event) => event.kind === 'notification' ? event.payload : undefined;
