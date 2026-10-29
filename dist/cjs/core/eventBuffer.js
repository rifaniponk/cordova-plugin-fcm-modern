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
var eventBuffer_exports = {};
__export(eventBuffer_exports, {
  DEFAULT_DEDUP_CACHE_SIZE: () => DEFAULT_DEDUP_CACHE_SIZE,
  DEFAULT_EVENT_BUFFER_SIZE: () => DEFAULT_EVENT_BUFFER_SIZE,
  EventBuffer: () => EventBuffer,
  eventKey: () => eventKey,
  isNotificationEvent: () => isNotificationEvent,
  payloadOf: () => payloadOf
});
module.exports = __toCommonJS(eventBuffer_exports);
const DEFAULT_EVENT_BUFFER_SIZE = 20;
const DEFAULT_DEDUP_CACHE_SIZE = 100;
const eventKey = (event, fallback) => {
  if (event.kind === "tokenRefresh") {
    return `token:${event.token}`;
  }
  const payload = event.payload;
  const space = payload.wasTapped === true ? "tap" : "receipt";
  const id = payload.messageId;
  if (typeof id === "string" && id.length > 0) {
    return `${space}:${id}`;
  }
  return `${space}:anon:${fallback}`;
};
class EventBuffer {
  constructor(queueLimit = DEFAULT_EVENT_BUFFER_SIZE, dedupLimit = DEFAULT_DEDUP_CACHE_SIZE) {
    __publicField(this, "state", { queue: [], seen: /* @__PURE__ */ new Set(), order: [] });
    __publicField(this, "anonymousCounter", 0);
    __publicField(this, "queueLimit");
    __publicField(this, "dedupLimit");
    __publicField(this, "dropped", 0);
    this.queueLimit = queueLimit;
    this.dedupLimit = dedupLimit;
    if (queueLimit < 0 || dedupLimit < 0) {
      throw new RangeError("event buffer limits must not be negative");
    }
  }
  get size() {
    return this.state.queue.length;
  }
  get droppedCount() {
    return this.dropped;
  }
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
      if (oldest !== void 0) {
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
const isNotificationEvent = (event) => event.kind === "notification";
const payloadOf = (event) => event.kind === "notification" ? event.payload : void 0;
