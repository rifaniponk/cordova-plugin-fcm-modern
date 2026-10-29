"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var eventTarget_exports = {};
__export(eventTarget_exports, {
  CountingEventTarget: () => CountingEventTarget,
  NOTIFICATION_EVENT: () => NOTIFICATION_EVENT,
  TOKEN_REFRESH_EVENT: () => TOKEN_REFRESH_EVENT
});
module.exports = __toCommonJS(eventTarget_exports);
const NOTIFICATION_EVENT = "notification";
const TOKEN_REFRESH_EVENT = "tokenRefresh";
const isPluginEvent = (type) => type === NOTIFICATION_EVENT || type === TOKEN_REFRESH_EVENT;
const callListener = (listener, target, event) => {
  if (typeof listener === "function") {
    listener.call(target, event);
    return;
  }
  listener.handleEvent(event);
};
class CountingEventTarget extends EventTarget {
  constructor() {
    super(...arguments);
    __publicField(this, "counts", /* @__PURE__ */ new Map());
    __publicField(this, "registered", /* @__PURE__ */ new Map());
    __publicField(this, "onSubscribe");
  }
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
    const capture = typeof options === "boolean" ? options : options?.capture === true;
    const once = typeof options === "object" && options !== null && options.once === true;
    const signal = typeof options === "object" && options !== null ? options.signal : void 0;
    if (signal?.aborted === true) {
      return;
    }
    const entries = this.registered.get(type) ?? [];
    if (entries.some((entry2) => entry2.listener === listener && entry2.capture === capture)) {
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
        this.detach(type, entry);
        callListener(entry.listener, this, event);
      };
    }
    entries.push(entry);
    this.registered.set(type, entries);
    if (signal !== void 0) {
      signal.addEventListener(
        "abort",
        () => this.removeEventListener(type, listener, { capture }),
        { once: true, signal: entry.controller.signal }
      );
    }
    super.addEventListener(type, entry.registered, options);
    this.adjust(type, 1);
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    if (!isPluginEvent(type) || listener === null) {
      return;
    }
    const capture = typeof options === "boolean" ? options : options?.capture === true;
    const entries = this.registered.get(type);
    if (entries === void 0) {
      return;
    }
    const entry = entries.find(
      (candidate) => candidate.listener === listener && candidate.capture === capture
    );
    if (entry === void 0) {
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
    if (entries === void 0 || index < 0) {
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
    } else {
      this.counts.delete(type);
    }
    if (delta > 0 && next > 0) {
      this.onSubscribe?.(type);
    }
  }
}
