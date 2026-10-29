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

// src/cordova/index.ts
var index_exports = {};
__export(index_exports, {
  CordovaBridge: () => CordovaBridge,
  FCM: () => FCM,
  FCMCore: () => FCMCore,
  FCMError: () => FCMError,
  FCMPlugin: () => FCMCore,
  FCM_ERROR_CODES: () => FCM_ERROR_CODES,
  createFCM: () => createFCM,
  default: () => index_default,
  getCordovaHost: () => getCordovaHost,
  isFCMError: () => isFCMError,
  sharedFCM: () => sharedFCM,
  sharedFCMKey: () => sharedFCMKey,
  toFCMError: () => toFCMError
});
module.exports = __toCommonJS(index_exports);

// src/core/errors.ts
var FCM_ERROR_CODES = [
  "unsupported_platform",
  "bridge_unavailable",
  "invalid_argument",
  "native_error",
  "timeout",
  "not_initialized"
];
var FCMError = class extends Error {
  constructor(code, message, options) {
    super(message);
    __publicField(this, "code");
    __publicField(this, "platform");
    __publicField(this, "cause");
    this.name = "FCMError";
    this.code = code;
    this.platform = options?.platform;
    this.cause = options?.cause;
  }
};
var isFCMError = (value) => value instanceof FCMError || typeof value === "object" && value !== null && value.name === "FCMError" && typeof value.code === "string";
var isSupportedCode = (value) => typeof value === "string" && FCM_ERROR_CODES.includes(value);
var nativeCode = (raw) => {
  if (typeof raw !== "object" || raw === null) {
    return void 0;
  }
  const code = raw.code;
  return isSupportedCode(code) ? code : void 0;
};
var toFCMError = (code, raw, fallbackMessage, platform) => {
  if (raw instanceof FCMError) {
    return raw;
  }
  const resolvedCode = nativeCode(raw) ?? code;
  if (raw instanceof Error) {
    return new FCMError(resolvedCode, raw.message || fallbackMessage, {
      platform,
      cause: raw
    });
  }
  if (typeof raw === "string" && raw.length > 0) {
    return new FCMError(resolvedCode, raw, { platform, cause: raw });
  }
  if (typeof raw === "object" && raw !== null) {
    const record = raw;
    const message = typeof record.message === "string" && record.message.length > 0 ? record.message : fallbackMessage;
    return new FCMError(resolvedCode, message, { platform, cause: record.cause ?? raw });
  }
  return new FCMError(resolvedCode, fallbackMessage, { platform, cause: raw });
};

// src/core/eventBuffer.ts
var DEFAULT_EVENT_BUFFER_SIZE = 20;
var DEFAULT_DEDUP_CACHE_SIZE = 100;
var eventKey = (event, fallback) => {
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
var EventBuffer = class {
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
};

// src/core/eventTarget.ts
var NOTIFICATION_EVENT = "notification";
var TOKEN_REFRESH_EVENT = "tokenRefresh";
var isPluginEvent = (type) => type === NOTIFICATION_EVENT || type === TOKEN_REFRESH_EVENT;
var callListener = (listener, target, event) => {
  if (typeof listener === "function") {
    listener.call(target, event);
    return;
  }
  listener.handleEvent(event);
};
var CountingEventTarget = class extends EventTarget {
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
};

// src/core/payload.ts
var RESERVED_KEYS = [
  "wasTapped",
  "title",
  "subtitle",
  "body",
  "badge",
  "messageId",
  "custom",
  "_fcm"
];
var UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var safeKey = (key) => !UNSAFE_KEYS.includes(key);
var assign = (target, key, value) => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });
};
var asText = (value) => typeof value === "string" ? value : typeof value === "number" ? String(value) : void 0;
var asCount = (value) => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : void 0;
};
var extractMessageId = (raw) => {
  for (const key of ["messageId", "gcm.message_id", "_id", "_fcm_message_id"]) {
    const value = asText(raw[key]);
    if (value !== void 0 && value.length > 0) {
      return value;
    }
  }
  const nested = raw["gcm"];
  if (isRecord(nested)) {
    const value = asText(nested["message_id"]);
    if (value !== void 0 && value.length > 0) {
      return value;
    }
  }
  return void 0;
};
var sanitizeNotificationPayload = (raw) => {
  if (!isRecord(raw)) {
    return null;
  }
  const envelope = raw;
  const payload = {};
  const collisions = [];
  const dropped = [];
  assign(payload, "wasTapped", envelope.wasTapped === true);
  const messageId = extractMessageId(envelope);
  if (messageId !== void 0) {
    assign(payload, "messageId", messageId);
  }
  for (const key of ["title", "subtitle", "body"]) {
    const value = asText(envelope[key]);
    if (value !== void 0) {
      assign(payload, key, value);
    }
  }
  const badge = asCount(envelope.badge);
  if (badge !== void 0) {
    assign(payload, "badge", badge);
  }
  const reserved = new Set(RESERVED_KEYS);
  const userEntries = isRecord(envelope.data) ? Object.entries(envelope.data) : Object.entries(envelope).filter(([key]) => !reserved.has(key));
  for (const [key, value] of userEntries) {
    if (!safeKey(key)) {
      dropped.push(key);
      continue;
    }
    if (reserved.has(key)) {
      collisions.push(key);
      const custom = payload.custom ?? {};
      if (payload.custom === void 0) {
        assign(payload, "custom", custom);
      }
      if (safeKey(key)) {
        assign(custom, key, value);
      }
      continue;
    }
    assign(payload, key, value);
  }
  if (collisions.length > 0 || dropped.length > 0) {
    const meta = {};
    if (collisions.length > 0) {
      assign(meta, "collisions", collisions);
    }
    if (dropped.length > 0) {
      assign(meta, "dropped", dropped);
    }
    assign(payload, "_fcm", meta);
  }
  return payload;
};

// src/core/fcmCore.ts
var DEFAULT_CALL_TIMEOUT_MS = 15e3;
var TOKEN_BUFFER_SIZE = 1;
var TOPIC_PATTERN = /^[a-zA-Z0-9\-_.~%]{1,900}$/;
var CHANNEL_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var toBoolean = (value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    return normalised === "true" || normalised === "1";
  }
  return false;
};
var notifySafely = (listener, value, onError) => {
  try {
    listener.callback(value);
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
};
var FCMCore = class {
  constructor(bridge, options = {}) {
    __publicField(this, "eventTarget");
    __publicField(this, "platformId");
    __publicField(this, "notificationListeners", []);
    __publicField(this, "tokenListeners", []);
    __publicField(this, "notifications");
    __publicField(this, "tokens");
    __publicField(this, "options");
    __publicField(this, "initPromise", null);
    __publicField(this, "bridgeTeardown", null);
    /**
     * Bumped whenever the event stream is re-attached. A transport error callback
     * captured by an older generation can still arrive after its teardown ran;
     * the generation lets recovery ignore those stale callbacks instead of
     * tearing down the newer bridge.
     */
    __publicField(this, "bridgeGeneration", 0);
    __publicField(this, "attempts", /* @__PURE__ */ new Map());
    __publicField(this, "initialPayloadCache");
    __publicField(this, "disposed", false);
    __publicField(this, "bridge");
    __publicField(this, "replayPending", {
      notification: false,
      tokenRefresh: false
    });
    this.bridge = bridge;
    this.options = {
      autoInitialize: options.autoInitialize ?? true,
      eventBufferSize: options.eventBufferSize ?? 20,
      dedupCacheSize: options.dedupCacheSize ?? 100,
      autoSubscribeTopics: options.autoSubscribeTopics ?? [],
      callTimeoutMs: options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
      foregroundPresentation: options.foregroundPresentation
    };
    this.eventTarget = new CountingEventTarget();
    this.eventTarget.setOnSubscribe(
      (type) => this.scheduleReplay(type === NOTIFICATION_EVENT ? "notification" : "tokenRefresh")
    );
    this.platformId = bridge.platformId;
    this.notifications = new EventBuffer(
      this.options.eventBufferSize,
      this.options.dedupCacheSize
    );
    this.tokens = new EventBuffer(TOKEN_BUFFER_SIZE, this.options.dedupCacheSize);
    if (this.options.autoInitialize) {
      void this.initialize().catch(() => void 0);
    }
  }
  get platform() {
    return this.bridge.platformId;
  }
  /** Starts (or reuses) the native handshake. Safe to call repeatedly. */
  initialize() {
    if (this.disposed) {
      return Promise.reject(
        new FCMError("not_initialized", "This FCM instance has been disposed")
      );
    }
    if (this.initPromise !== null) {
      return this.initPromise;
    }
    const generation = this.bridgeGeneration + 1;
    const handshake = this.runInitialization();
    if (handshake === null) {
      return Promise.reject(
        new FCMError("not_initialized", "This FCM instance has been disposed")
      );
    }
    const pending = handshake.catch((error) => {
      if (this.initPromise === pending) {
        this.initPromise = null;
      }
      throw error;
    });
    this.initPromise = pending;
    const attempt = this.attempts.get(generation);
    if (attempt !== void 0) {
      attempt.promise = pending;
    }
    return pending;
  }
  ready() {
    return this.initialize();
  }
  /**
   * The event stream can die after the handshake settled (Cordova's keep-alive
   * error callback arrives whenever native drops the sink). `initPromise` is a
   * settled memo, so without recovery every later `ready`/`getToken` reports
   * success while there is no notification sink at all.
   *
   * Which of two shapes applies depends on whether the failing attempt has
   * already settled. While a handshake is still in flight the failure is
   * recorded for *that* attempt and fails its own promise (native answering
   * `ready` must not mask a dead sink); once it has settled there is no promise
   * left to fail, so recovery detaches, retires the memo and reattaches.
   */
  handleStreamFailure(error, generation) {
    if (this.disposed || generation !== this.bridgeGeneration) {
      return;
    }
    const failedAttempt = this.attempts.get(generation);
    if (failedAttempt === void 0) {
      return;
    }
    if (!failedAttempt.settled) {
      failedAttempt.transportFailure ?? (failedAttempt.transportFailure = error);
      return;
    }
    this.retireAttempt(generation);
    if (this.initPromise === failedAttempt.promise) {
      this.initPromise = null;
    }
    void this.initialize().catch(() => void 0);
  }
  /** Detaches the stream of `generation` unless a newer attempt already owns it. */
  retireAttempt(generation) {
    this.attempts.delete(generation);
    if (generation !== this.bridgeGeneration) {
      return;
    }
    this.teardownBridge();
    this.bridgeGeneration++;
  }
  /**
   * The handshake proper. Kept separate from `initialize()` so the attempt's
   * bookkeeping — registering it, then marking it settled at its real
   * completion boundary — lives in one place.
   */
  async performHandshake(attempt, generation) {
    const takeTransportFailure = () => {
      const failure = attempt.transportFailure;
      attempt.transportFailure = void 0;
      return failure ?? null;
    };
    this.bridgeTeardown = this.bridge.addEventListener(
      (event) => {
        if (generation === this.bridgeGeneration) {
          this.handleNativeEvent(event);
        }
      },
      (error) => this.handleStreamFailure(error, generation)
    );
    try {
      await this.awaitEventRegistration();
      const registrationFailure = takeTransportFailure();
      if (registrationFailure !== null) {
        throw registrationFailure;
      }
      await this.callNative("ready");
      const readyFailure = takeTransportFailure();
      if (readyFailure !== null) {
        throw readyFailure;
      }
    } catch (error) {
      this.retireAttempt(generation);
      if (isFCMError(error) && error.code === "timeout") {
        throw error;
      }
      const reason = toFCMError(
        "bridge_unavailable",
        error,
        "FCM native bridge is not available",
        this.platformId
      );
      throw new FCMError("bridge_unavailable", reason.message, {
        platform: this.platformId,
        cause: error
      });
    }
    if (this.options.foregroundPresentation) {
      await this.callNative("setForegroundPresentation", [
        this.options.foregroundPresentation
      ]);
    }
    for (const topic of this.options.autoSubscribeTopics) {
      this.assertTopic(topic);
      await this.callNative("subscribeToTopic", [topic]);
    }
    await this.callNative("replayBufferedEvents");
  }
  runInitialization() {
    if (this.disposed) {
      return null;
    }
    if (this.bridge.runtime === "web") {
      return Promise.reject(
        new FCMError(
          "unsupported_platform",
          "This build has no browser push implementation",
          {
            platform: this.bridge.platformId
          }
        )
      );
    }
    const generation = ++this.bridgeGeneration;
    const attempt = { settled: false };
    this.attempts.set(generation, attempt);
    const settled = this.performHandshake(attempt, generation).then(
      () => {
        attempt.settled = true;
        const late = attempt.transportFailure;
        if (late !== void 0 && this.attempts.get(generation) === attempt) {
          attempt.transportFailure = void 0;
          this.handleStreamFailure(late, generation);
        }
      },
      (error) => {
        throw error;
      }
    );
    return settled.then(() => void 0);
  }
  teardownBridge() {
    if (this.bridgeTeardown !== null) {
      try {
        this.bridgeTeardown();
      } catch {
      }
      this.bridgeTeardown = null;
    }
  }
  /** Releases the bridge and all listeners. Idempotent. */
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.teardownBridge();
    this.bridgeGeneration++;
    this.attempts.clear();
    this.notificationListeners.length = 0;
    this.tokenListeners.length = 0;
    this.notifications.drain();
    this.tokens.drain();
  }
  // ---------------------------------------------------------------- events
  subscriberCount(kind) {
    if (kind === "notification") {
      return this.notificationListeners.length + this.eventTarget.subscriberCount(NOTIFICATION_EVENT);
    }
    return this.tokenListeners.length + this.eventTarget.subscriberCount(TOKEN_REFRESH_EVENT);
  }
  handleNativeEvent(event) {
    if (this.disposed) {
      return;
    }
    let normalized;
    let buffer;
    if (event.kind === "tokenRefresh") {
      const token = typeof event.token === "string" ? event.token : "";
      if (token.length === 0) {
        return;
      }
      normalized = { kind: "tokenRefresh", token };
      buffer = this.tokens;
    } else {
      const payload = sanitizeNotificationPayload(event.payload);
      if (payload === null) {
        return;
      }
      normalized = { kind: "notification", payload };
      buffer = this.notifications;
    }
    const kind = normalized.kind === "notification" ? "notification" : "tokenRefresh";
    if (!buffer.tryAccept(normalized)) {
      return;
    }
    if (this.subscriberCount(kind) === 0 || this.replayPending[kind]) {
      buffer.enqueue(normalized);
      return;
    }
    this.emit(normalized);
  }
  emit(event) {
    if (event.kind === "notification") {
      this.dispatch(NOTIFICATION_EVENT, event.payload);
      this.deliverNotification(event);
      return;
    }
    this.dispatch(TOKEN_REFRESH_EVENT, event.token);
    this.deliverToken(event);
  }
  deliverNotification(event) {
    const listeners = [...this.notificationListeners];
    for (const listener of listeners) {
      const index = this.notificationListeners.indexOf(listener);
      if (listener.once && index >= 0) {
        this.notificationListeners.splice(index, 1);
      }
      notifySafely(listener, event.payload, () => void 0);
    }
  }
  deliverToken(event) {
    const listeners = [...this.tokenListeners];
    for (const listener of listeners) {
      const index = this.tokenListeners.indexOf(listener);
      if (listener.once && index >= 0) {
        this.tokenListeners.splice(index, 1);
      }
      notifySafely(listener, event.token, () => void 0);
    }
  }
  dispatch(name, detail) {
    try {
      this.eventTarget.dispatchEvent(new CustomEvent(name, { detail }));
    } catch {
    }
  }
  /**
   * Replay is deferred to the next microtask so that attaching several listeners
   * in one tick replays to all of them, and so that disposing before the replay
   * runs means nothing is delivered at all.
   *
   * The queue is drained only as far as there are subscribers: a `once`
   * listener consumes one event and the rest stay buffered for the next
   * subscriber, rather than being silently swallowed.
   */
  scheduleReplay(kind) {
    const buffer = kind === "notification" ? this.notifications : this.tokens;
    if (buffer.size === 0 || this.replayPending[kind]) {
      return;
    }
    this.replayPending[kind] = true;
    queueMicrotask(() => {
      this.replayPending[kind] = false;
      if (this.disposed) {
        return;
      }
      while (this.subscriberCount(kind) > 0) {
        const event = buffer.next();
        if (event === void 0) {
          break;
        }
        this.emit(event);
      }
    });
  }
  onNotification(callback, options = {}) {
    if (typeof callback !== "function") {
      throw new FCMError("invalid_argument", "onNotification requires a callback function");
    }
    const listener = { callback, once: options.once === true };
    this.notificationListeners.push(listener);
    this.scheduleReplay("notification");
    return {
      dispose: () => {
        const index = this.notificationListeners.indexOf(listener);
        if (index >= 0) {
          this.notificationListeners.splice(index, 1);
        }
      }
    };
  }
  onTokenRefresh(callback, options = {}) {
    if (typeof callback !== "function") {
      throw new FCMError("invalid_argument", "onTokenRefresh requires a callback function");
    }
    const listener = { callback, once: options.once === true };
    this.tokenListeners.push(listener);
    this.scheduleReplay("tokenRefresh");
    return {
      dispose: () => {
        const index = this.tokenListeners.indexOf(listener);
        if (index >= 0) {
          this.tokenListeners.splice(index, 1);
        }
      }
    };
  }
  // ------------------------------------------------------------ native calls
  callNative(action, args = []) {
    if (this.disposed) {
      return Promise.reject(
        new FCMError("not_initialized", "This FCM instance has been disposed")
      );
    }
    const call = this.bridge.call(action, args).then(
      (value) => value,
      (error) => {
        throw toFCMError(
          "native_error",
          error,
          `FCM native call "${action}" failed`,
          this.platformId
        );
      }
    );
    return this.withTimeout(call, `FCM native call "${action}"`);
  }
  /**
   * Bounds a native promise by `callTimeoutMs`. The resulting error keeps the
   * distinct `timeout` code: "the native side never answered" is a different
   * diagnosis from "the bridge is offline" and must not be flattened.
   */
  withTimeout(work, label) {
    if (this.options.callTimeoutMs <= 0) {
      return work;
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(
          new FCMError("timeout", `${label} timed out`, {
            platform: this.platformId
          })
        );
      }, this.options.callTimeoutMs);
      work.then(
        (value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }
  /**
   * Waits for an asynchronous native event registration (Capacitor) to settle
   * before `ready`/`replayBufferedEvents` run. Bridges without asynchronous
   * registration (Cordova's keep-alive callback) have nothing to wait for.
   */
  awaitEventRegistration() {
    const registration = this.bridge.waitForEventRegistration?.();
    if (registration === void 0) {
      return Promise.resolve();
    }
    return this.withTimeout(registration, "FCM native event listener registration");
  }
  /** Awaits initialization first, so callers never race the handshake. */
  async invoke(action, args = []) {
    await this.initialize();
    return this.callNative(action, args);
  }
  getToken() {
    return this.invoke("getToken").then((token) => {
      if (typeof token !== "string" || token.length === 0) {
        throw new FCMError("native_error", "Native returned no registration token", {
          platform: this.platformId
        });
      }
      return token;
    });
  }
  /** Deletes the current FCM registration token for this app instance. */
  deleteToken() {
    return this.invoke("deleteToken").then(() => void 0);
  }
  /**
   * Compatibility alias for `deleteToken()`. In 7.x this name implied the
   * whole Firebase installation was removed; it only ever revoked the
   * messaging token, and 8.x keeps exactly that behaviour.
   */
  deleteInstanceId() {
    return this.deleteToken();
  }
  getAPNSToken() {
    if (this.platformId !== "ios") {
      return Promise.resolve("");
    }
    return this.invoke("getAPNSToken").then(
      (token) => typeof token === "string" ? token : ""
    );
  }
  getInitialPushPayload() {
    if (this.initialPayloadCache !== void 0) {
      return Promise.resolve(this.initialPayloadCache);
    }
    return this.invoke("getInitialPushPayload").then((raw) => {
      if (!isRecord2(raw)) {
        this.initialPayloadCache = null;
        return null;
      }
      const payload = sanitizeNotificationPayload(raw);
      this.initialPayloadCache = payload;
      return payload;
    });
  }
  hasPermission() {
    return this.invoke("hasPermission").then(toBoolean);
  }
  requestPushPermission(options = {}) {
    const { ios9Support: _ignored, ...rest } = options;
    return this.invoke("requestPushPermission", [rest]).then(toBoolean);
  }
  subscribeToTopic(topic) {
    const invalid = this.topicError(topic);
    if (invalid !== null) {
      return Promise.reject(invalid);
    }
    return this.invoke("subscribeToTopic", [topic]).then(() => void 0);
  }
  unsubscribeFromTopic(topic) {
    const invalid = this.topicError(topic);
    if (invalid !== null) {
      return Promise.reject(invalid);
    }
    return this.invoke("unsubscribeFromTopic", [topic]).then(() => void 0);
  }
  clearAllNotifications() {
    return this.invoke("clearAllNotifications").then(() => void 0);
  }
  /**
   * Turns Firebase's own auto-initialisation on or off. Explicit by design:
   * the host app owns the consent decision, the plugin never guesses it.
   */
  setAutoInitEnabled(enabled) {
    if (typeof enabled !== "boolean") {
      return Promise.reject(
        new FCMError("invalid_argument", "setAutoInitEnabled requires a boolean", {
          platform: this.platformId
        })
      );
    }
    return this.invoke("setAutoInitEnabled", [enabled]).then(() => void 0);
  }
  isAutoInitEnabled() {
    return this.invoke("isAutoInitEnabled").then(toBoolean);
  }
  createNotificationChannel(channelConfig) {
    if (this.platformId !== "android") {
      return Promise.resolve();
    }
    if (!isRecord2(channelConfig)) {
      return Promise.reject(
        new FCMError(
          "invalid_argument",
          "createNotificationChannel requires a configuration object",
          {
            platform: this.platformId
          }
        )
      );
    }
    if (typeof channelConfig.id !== "string" || !CHANNEL_ID_PATTERN.test(channelConfig.id)) {
      return Promise.reject(
        new FCMError("invalid_argument", "Notification channel id is invalid", {
          platform: this.platformId
        })
      );
    }
    if (typeof channelConfig.name !== "string" || channelConfig.name.length === 0 || channelConfig.name.length > 200) {
      return Promise.reject(
        new FCMError("invalid_argument", "Notification channel name is invalid", {
          platform: this.platformId
        })
      );
    }
    return this.invoke("createNotificationChannel", [channelConfig]).then(() => void 0);
  }
  /** Opt-in: by default foreground messages are event-only. */
  configureForegroundPresentation(options) {
    const payload = {
      alert: options.alert === true,
      sound: options.sound === true,
      badge: options.badge === true
    };
    if (typeof options.channelId === "string" && CHANNEL_ID_PATTERN.test(options.channelId)) {
      payload.channelId = options.channelId;
    }
    return this.invoke("setForegroundPresentation", [payload]).then(() => void 0);
  }
  /** Opt-in only: 7.x auto-subscribed to all/android/ios, 8.x never does. */
  setAutoSubscribeTopics(topics) {
    if (!Array.isArray(topics)) {
      throw new FCMError(
        "invalid_argument",
        "autoSubscribeTopics must be an array of strings"
      );
    }
    for (const topic of topics) {
      this.assertTopic(topic);
    }
    this.options.autoSubscribeTopics = [...topics];
  }
  topicError(topic) {
    if (typeof topic !== "string" || !TOPIC_PATTERN.test(topic)) {
      return new FCMError(
        "invalid_argument",
        `Invalid FCM topic name: ${JSON.stringify(topic)}`,
        {
          platform: this.platformId
        }
      );
    }
    return null;
  }
  assertTopic(topic) {
    const error = this.topicError(topic);
    if (error !== null) {
      throw error;
    }
  }
};

// src/core/instance.ts
var SHARED_INSTANCE_KEY = /* @__PURE__ */ Symbol.for("cordova-plugin-fcm-modern.fcm.instance");
var sharedFCM = (create) => {
  const host2 = globalThis;
  const existing = host2[SHARED_INSTANCE_KEY];
  if (existing !== void 0) {
    return existing;
  }
  const created = create();
  host2[SHARED_INSTANCE_KEY] = created;
  return created;
};
var sharedFCMKey = SHARED_INSTANCE_KEY;

// src/core/runtime.ts
var readHost = () => {
  const global = globalThis;
  if (typeof global.window === "object" && global.window !== null) {
    return global.window;
  }
  if (global.Capacitor || global.cordova) {
    return { Capacitor: global.Capacitor, cordova: global.cordova };
  }
  return void 0;
};

// src/bridges/cordovaBridge.ts
var BRIDGE_SERVICE = "FCMPlugin";
var getCordovaHost = () => {
  const host2 = readHost();
  const cordova = host2?.cordova;
  if (cordova && typeof cordova.exec === "function") {
    return cordova;
  }
  return null;
};
var normalisePlatform = (value) => value === "android" || value === "ios" ? value : "unknown";
var parseNativeEnvelope = (raw) => {
  if (!Array.isArray(raw) || raw.length < 2) {
    return "malformed";
  }
  const [name, value] = raw;
  if (name === "notification") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return "malformed";
    }
    return { kind: "notification", payload: value };
  }
  if (name === "tokenRefresh") {
    if (typeof value !== "string") {
      return "malformed";
    }
    return { kind: "tokenRefresh", token: value };
  }
  return null;
};
var CordovaBridge = class _CordovaBridge {
  constructor(cordova, platformId) {
    __publicField(this, "runtime", "cordova");
    __publicField(this, "platformId");
    __publicField(this, "attached", false);
    __publicField(this, "cordova");
    this.cordova = cordova;
    this.platformId = platformId ?? normalisePlatform(cordova?.platformId);
  }
  static create(platformId) {
    return new _CordovaBridge(getCordovaHost(), platformId);
  }
  call(action, args = []) {
    const cordova = this.cordova;
    if (cordova === null) {
      return Promise.reject(
        new FCMError(
          "bridge_unavailable",
          "Cordova bridge is not present in this environment (window.cordova.exec)",
          { platform: this.platformId }
        )
      );
    }
    return new Promise((resolve, reject) => {
      try {
        cordova.exec(
          (value) => resolve(value),
          (error) => reject(
            toFCMError(
              "native_error",
              error,
              `Cordova "${action}" failed`,
              this.platformId
            )
          ),
          BRIDGE_SERVICE,
          action,
          [...args]
        );
      } catch (error) {
        reject(
          toFCMError(
            "bridge_unavailable",
            error,
            `Cordova "${action}" threw`,
            this.platformId
          )
        );
      }
    });
  }
  /**
   * Installs the native event bridge. The callback is keep-alive: every native
   * payload arrives as a JSON string `[eventName, data]`.
   */
  addEventListener(listener, onTransportError) {
    if (this.attached || this.cordova === null) {
      return () => void 0;
    }
    this.attached = true;
    let active = true;
    const report = (code, message, cause) => {
      onTransportError?.(new FCMError(code, message, { platform: this.platformId, cause }));
    };
    const onRaw = (data) => {
      if (!active) {
        return;
      }
      if (typeof data !== "string") {
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (error) {
        report("native_error", "Malformed native event payload", error);
        return;
      }
      const event = parseNativeEnvelope(parsed);
      if (event === "malformed") {
        report("native_error", "Native event does not match [eventName, value]");
        return;
      }
      if (event !== null) {
        listener(event);
      }
    };
    const onFail = (error) => {
      active = false;
      this.attached = false;
      onTransportError?.(
        toFCMError(
          "bridge_unavailable",
          error,
          "Native event bridge failed",
          this.platformId
        )
      );
    };
    try {
      this.cordova.exec(onRaw, onFail, BRIDGE_SERVICE, "startJsEventBridge", []);
    } catch (error) {
      this.attached = false;
      active = false;
      onTransportError?.(
        toFCMError(
          "bridge_unavailable",
          error,
          "Native event bridge could not start",
          this.platformId
        )
      );
    }
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.attached = false;
      try {
        this.cordova?.exec(
          () => void 0,
          () => void 0,
          BRIDGE_SERVICE,
          "stopJsEventBridge",
          []
        );
      } catch {
      }
    };
  }
};

// src/cordova/index.ts
var createFCM = (options = {}) => new FCMCore(CordovaBridge.create(), options);
var FCM = sharedFCM(() => new FCMCore(CordovaBridge.create()));
var host = globalThis;
if (typeof host.window === "object" && host.window !== null && getCordovaHost() !== null) {
  host.window.FCM = FCM;
}
var index_default = FCM;

// Legacy compat: window.FCM must be the FCM instance itself.
module.exports = module.exports.default
