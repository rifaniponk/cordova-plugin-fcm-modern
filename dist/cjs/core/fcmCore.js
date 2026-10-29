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
var fcmCore_exports = {};
__export(fcmCore_exports, {
  FCMCore: () => FCMCore
});
module.exports = __toCommonJS(fcmCore_exports);
var import_errors = require("./errors.js");
var import_eventBuffer = require("./eventBuffer.js");
var import_eventTarget = require("./eventTarget.js");
var import_payload = require("./payload.js");
const DEFAULT_CALL_TIMEOUT_MS = 15e3;
const TOKEN_BUFFER_SIZE = 1;
const TOPIC_PATTERN = /^[a-zA-Z0-9\-_.~%]{1,900}$/;
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const toBoolean = (value) => {
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
const notifySafely = (listener, value, onError) => {
  try {
    listener.callback(value);
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
};
class FCMCore {
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
    this.eventTarget = new import_eventTarget.CountingEventTarget();
    this.eventTarget.setOnSubscribe(
      (type) => this.scheduleReplay(type === import_eventTarget.NOTIFICATION_EVENT ? "notification" : "tokenRefresh")
    );
    this.platformId = bridge.platformId;
    this.notifications = new import_eventBuffer.EventBuffer(
      this.options.eventBufferSize,
      this.options.dedupCacheSize
    );
    this.tokens = new import_eventBuffer.EventBuffer(TOKEN_BUFFER_SIZE, this.options.dedupCacheSize);
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
        new import_errors.FCMError("not_initialized", "This FCM instance has been disposed")
      );
    }
    if (this.initPromise !== null) {
      return this.initPromise;
    }
    const generation = this.bridgeGeneration + 1;
    const handshake = this.runInitialization();
    if (handshake === null) {
      return Promise.reject(
        new import_errors.FCMError("not_initialized", "This FCM instance has been disposed")
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
      if ((0, import_errors.isFCMError)(error) && error.code === "timeout") {
        throw error;
      }
      const reason = (0, import_errors.toFCMError)(
        "bridge_unavailable",
        error,
        "FCM native bridge is not available",
        this.platformId
      );
      throw new import_errors.FCMError("bridge_unavailable", reason.message, {
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
        new import_errors.FCMError(
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
      return this.notificationListeners.length + this.eventTarget.subscriberCount(import_eventTarget.NOTIFICATION_EVENT);
    }
    return this.tokenListeners.length + this.eventTarget.subscriberCount(import_eventTarget.TOKEN_REFRESH_EVENT);
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
      const payload = (0, import_payload.sanitizeNotificationPayload)(event.payload);
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
      this.dispatch(import_eventTarget.NOTIFICATION_EVENT, event.payload);
      this.deliverNotification(event);
      return;
    }
    this.dispatch(import_eventTarget.TOKEN_REFRESH_EVENT, event.token);
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
      throw new import_errors.FCMError("invalid_argument", "onNotification requires a callback function");
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
      throw new import_errors.FCMError("invalid_argument", "onTokenRefresh requires a callback function");
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
        new import_errors.FCMError("not_initialized", "This FCM instance has been disposed")
      );
    }
    const call = this.bridge.call(action, args).then(
      (value) => value,
      (error) => {
        throw (0, import_errors.toFCMError)(
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
          new import_errors.FCMError("timeout", `${label} timed out`, {
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
        throw new import_errors.FCMError("native_error", "Native returned no registration token", {
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
      if (!isRecord(raw)) {
        this.initialPayloadCache = null;
        return null;
      }
      const payload = (0, import_payload.sanitizeNotificationPayload)(raw);
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
        new import_errors.FCMError("invalid_argument", "setAutoInitEnabled requires a boolean", {
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
    if (!isRecord(channelConfig)) {
      return Promise.reject(
        new import_errors.FCMError(
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
        new import_errors.FCMError("invalid_argument", "Notification channel id is invalid", {
          platform: this.platformId
        })
      );
    }
    if (typeof channelConfig.name !== "string" || channelConfig.name.length === 0 || channelConfig.name.length > 200) {
      return Promise.reject(
        new import_errors.FCMError("invalid_argument", "Notification channel name is invalid", {
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
      throw new import_errors.FCMError(
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
      return new import_errors.FCMError(
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
}
