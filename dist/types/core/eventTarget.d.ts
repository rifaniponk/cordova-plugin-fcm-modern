/**
 * An EventTarget that knows whether anyone is subscribed to the plugin's own
 * event names. The core needs that to decide between live delivery and buffering:
 * `eventTarget` listeners are subscribers too, so an app that only uses the event
 * target must never have a live event silently buffered and replayed later.
 *
 * `EventTarget` exists in every supported runtime (Android System WebView 52+,
 * iOS 10+ WKWebView, Node 18+ for tests).
 */
export declare const NOTIFICATION_EVENT = "notification";
export declare const TOKEN_REFRESH_EVENT = "tokenRefresh";
export declare class CountingEventTarget extends EventTarget {
    private readonly counts;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
    subscriberCount(type: string): number;
}
