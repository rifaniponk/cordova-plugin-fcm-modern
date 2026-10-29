import type { INotificationPayload, NativeEvent } from './types.js';
export type EventSpace = 'receipt' | 'tap' | 'token';
export declare const DEFAULT_EVENT_BUFFER_SIZE = 20;
export declare const DEFAULT_DEDUP_CACHE_SIZE = 100;
/**
 * Dedup key for an event. Receipts and taps are separate identity spaces, so a
 * tap never disappears because the receipt of the same message was seen first.
 * Messages without an id are never deduplicated: there is no way to prove two
 * id-less messages are the same one, and collapsing them would lose deliveries.
 */
export declare const eventKey: (event: NativeEvent, fallback: string) => string | null;
/**
 * Bounded event store shared by every runtime. It is deliberately independent of
 * the bridge so a native replay burst can never grow memory without limit.
 */
export declare class EventBuffer {
    private readonly state;
    private anonymousCounter;
    private readonly queueLimit;
    private readonly dedupLimit;
    constructor(queueLimit?: number, dedupLimit?: number);
    get size(): number;
    get droppedCount(): number;
    private dropped;
    /**
     * Records the event as seen and reports whether it is new. This is the dedup
     * gate for the live path; `offer()` additionally queues it for replay.
     */
    tryAccept(event: NativeEvent): boolean;
    /**
     * Appends to the replay queue, dropping the oldest entry when full.
     * @returns whether the event was actually queued (false when the queue is disabled).
     */
    enqueue(event: NativeEvent): boolean;
    /**
     * Dedup + queue in one step. Dedup bookkeeping runs even when the queue is
     * disabled, so a limit-0 buffer still collapses repeats without storing them.
     * @returns false when the event was a duplicate or could not be queued.
     */
    offer(event: NativeEvent): boolean;
    markDelivered(event: NativeEvent): void;
    /** Pops the oldest queued event, or undefined when the queue is empty. */
    next(): NativeEvent | undefined;
    /** Drains the queue in arrival order. */
    drain(): NativeEvent[];
    private remember;
    /** Test/diagnostic helper: never contains payload bodies. */
    stats(): {
        queued: number;
        tracked: number;
        dropped: number;
    };
}
export declare const isNotificationEvent: (event: NativeEvent) => event is Extract<NativeEvent, {
    kind: "notification";
}>;
export declare const payloadOf: (event: NativeEvent) => INotificationPayload | undefined;
