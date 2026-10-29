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
export const NOTIFICATION_EVENT = 'notification';
export const TOKEN_REFRESH_EVENT = 'tokenRefresh';
const isPluginEvent = (type) => type === NOTIFICATION_EVENT || type === TOKEN_REFRESH_EVENT;
const callListener = (listener, target, event) => {
    if (typeof listener === 'function') {
        listener.call(target, event);
        return;
    }
    listener.handleEvent(event);
};
export class CountingEventTarget extends EventTarget {
    counts = new Map();
    registered = new Map();
    onSubscribe;
    /**
     * Called when a subscription *increases* the count of a plugin event type.
     * The core uses it to replay buffered events to a listener that attached
     * directly on the event target instead of through `onNotification()`.
     */
    setOnSubscribe(callback) {
        this.onSubscribe = callback;
    }
    addEventListener(type, listener, options) {
        if (!isPluginEvent(type) || listener === null) {
            super.addEventListener(type, listener, options);
            return;
        }
        const capture = typeof options === 'boolean' ? options : options?.capture === true;
        const once = typeof options === 'object' && options !== null && options.once === true;
        const signal = typeof options === 'object' && options !== null ? options.signal : undefined;
        if (signal?.aborted === true) {
            // The spec ignores an already-aborted registration, so counting it
            // would make the core deliver live to nobody.
            return;
        }
        const entries = this.registered.get(type) ?? [];
        if (entries.some((entry) => entry.listener === listener && entry.capture === capture)) {
            return;
        }
        const entry = {
            listener,
            registered: listener,
            capture,
            once,
            controller: new AbortController()
        };
        if (once) {
            entry.registered = (event) => {
                // A `once` registration leaves the list before its callback runs.
                this.detach(type, entry);
                callListener(entry.listener, this, event);
            };
        }
        entries.push(entry);
        this.registered.set(type, entries);
        if (signal !== undefined) {
            signal.addEventListener('abort', () => this.removeEventListener(type, listener, { capture }), { once: true, signal: entry.controller.signal });
        }
        super.addEventListener(type, entry.registered, options);
        this.adjust(type, 1);
    }
    removeEventListener(type, listener, options) {
        super.removeEventListener(type, listener, options);
        if (!isPluginEvent(type) || listener === null) {
            return;
        }
        const capture = typeof options === 'boolean' ? options : options?.capture === true;
        const entries = this.registered.get(type);
        if (entries === undefined) {
            return;
        }
        const entry = entries.find((candidate) => candidate.listener === listener && candidate.capture === capture);
        if (entry === undefined) {
            // Nothing was registered under this (listener, capture) pair: a
            // removal must not decrement a count it never raised.
            return;
        }
        this.detach(type, entry);
    }
    /**
     * Drops one registration from both the real listener list and the mirror.
     * Idempotent: a second attempt for the same entry changes nothing, so the
     * wrapper's own cleanup and an explicit `removeEventListener` cannot both
     * decrement.
     */
    detach(type, entry) {
        const entries = this.registered.get(type);
        const index = entries?.indexOf(entry) ?? -1;
        if (entries === undefined || index < 0) {
            return;
        }
        entry.controller.abort();
        super.removeEventListener(type, entry.registered, { capture: entry.capture });
        entries.splice(index, 1);
        if (entries.length === 0) {
            this.registered.delete(type);
        }
        this.adjust(type, -1);
    }
    subscriberCount(type) {
        return this.counts.get(type) ?? 0;
    }
    adjust(type, delta) {
        const next = (this.counts.get(type) ?? 0) + delta;
        if (next > 0) {
            this.counts.set(type, next);
        }
        else {
            this.counts.delete(type);
        }
        if (delta > 0 && next > 0) {
            this.onSubscribe?.(type);
        }
    }
}
