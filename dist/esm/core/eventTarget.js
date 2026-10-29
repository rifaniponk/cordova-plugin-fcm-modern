/**
 * An EventTarget that knows whether anyone is subscribed to the plugin's own
 * event names. The core needs that to decide between live delivery and buffering:
 * `eventTarget` listeners are subscribers too, so an app that only uses the event
 * target must never have a live event silently buffered and replayed later.
 *
 * `EventTarget` exists in every supported runtime (Android System WebView 52+,
 * iOS 10+ WKWebView, Node 18+ for tests).
 */
export const NOTIFICATION_EVENT = 'notification';
export const TOKEN_REFRESH_EVENT = 'tokenRefresh';
export class CountingEventTarget extends EventTarget {
    counts = new Map();
    addEventListener(type, listener, options) {
        super.addEventListener(type, listener, options);
        if (type === NOTIFICATION_EVENT || type === TOKEN_REFRESH_EVENT) {
            this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
        }
    }
    removeEventListener(type, listener, options) {
        super.removeEventListener(type, listener, options);
        if (type === NOTIFICATION_EVENT || type === TOKEN_REFRESH_EVENT) {
            const next = (this.counts.get(type) ?? 0) - 1;
            if (next > 0) {
                this.counts.set(type, next);
            }
            else {
                this.counts.delete(type);
            }
        }
    }
    subscriberCount(type) {
        return this.counts.get(type) ?? 0;
    }
}
