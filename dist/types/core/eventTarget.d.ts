/**
 * An EventTarget that knows whether anyone is subscribed to the plugin's own
 * event names. The core needs that to decide between live delivery and buffering:
 * `eventTarget` listeners are subscribers too, so an app that only uses the event
 * target must never have a live event silently buffered and replayed later.
 *
 * The count is a *mirror* of the real listener list, so it has to reproduce the
 * parts of the spec the core depends on: identical (listener, capture) pairs are
 * stored once, `{ once: true }` listeners leave after firing once, an aborted
 * `signal` detaches the listener, and a removal is only counted if something was
 * actually registered. A count that drifts upward loses events permanently,
 * because the core then delivers live to nobody.
 *
 * `EventTarget` exists in every supported runtime (Android System WebView 52+,
 * iOS 10+ WKWebView, Node 18+ for tests).
 */
export declare const NOTIFICATION_EVENT = "notification";
export declare const TOKEN_REFRESH_EVENT = "tokenRefresh";
export declare class CountingEventTarget extends EventTarget {
    private readonly counts;
    private readonly registered;
    private onSubscribe;
    /**
     * Called when a subscription *increases* the count of a plugin event type.
     * The core uses it to replay buffered events to a listener that attached
     * directly on the event target instead of through `onNotification()`.
     */
    setOnSubscribe(callback: (type: string) => void): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
    /**
     * Drops one registration from both the real listener list and the mirror.
     * Idempotent: a second attempt for the same entry changes nothing, so the
     * wrapper's own cleanup and an explicit `removeEventListener` cannot both
     * decrement.
     */
    private detach;
    subscriberCount(type: string): number;
    private adjust;
}
