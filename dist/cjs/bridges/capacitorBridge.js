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
var capacitorBridge_exports = {};
__export(capacitorBridge_exports, {
  CapacitorBridge: () => CapacitorBridge
});
module.exports = __toCommonJS(capacitorBridge_exports);
var import_errors = require("../core/errors.js");
class CapacitorBridge {
  constructor(plugin, platformId) {
    __publicField(this, "runtime", "capacitor");
    __publicField(this, "platformId");
    __publicField(this, "plugin");
    __publicField(this, "registration", null);
    this.plugin = plugin;
    this.platformId = platformId;
  }
  /** Resolves once the asynchronous `addListener` registrations have settled. */
  waitForEventRegistration() {
    return this.registration ?? Promise.resolve();
  }
  /**
   * Looks a native method up by name and rejects when it is absent, instead of
   * silently resolving `undefined` the way `plugin.getToken?.()` would.
   */
  method(name) {
    const candidate = this.plugin[name];
    if (typeof candidate !== "function") {
      throw new import_errors.FCMError(
        "bridge_unavailable",
        `Capacitor plugin "FCMPlugin" does not implement "${name}"`,
        { platform: this.platformId }
      );
    }
    return candidate.bind(this.plugin);
  }
  async dispatch(action, args) {
    const unwrapValue = async (call) => {
      const result = await call;
      return result?.value;
    };
    switch (action) {
      case "ready":
        return this.method("ready")();
      case "replayBufferedEvents":
        return this.method("replayBufferedEvents")();
      case "setForegroundPresentation":
        return this.method("setForegroundPresentation")(args[0]);
      case "getToken":
        return unwrapValue(this.method("getToken")());
      case "deleteToken":
        return this.method("deleteToken")();
      case "getAPNSToken":
        return unwrapValue(this.method("getAPNSToken")());
      case "getInitialPushPayload": {
        const result = await this.method("getInitialPushPayload")();
        return result?.payload ?? null;
      }
      case "hasPermission":
        return unwrapValue(this.method("hasPermission")());
      case "requestPushPermission":
        return unwrapValue(this.method("requestPushPermission")(args[0]));
      case "subscribeToTopic":
        return this.method("subscribeToTopic")({ topic: String(args[0]) });
      case "unsubscribeFromTopic":
        return this.method("unsubscribeFromTopic")({ topic: String(args[0]) });
      case "clearAllNotifications":
        return this.method("clearAllNotifications")();
      case "createNotificationChannel":
        return this.method("createNotificationChannel")(args[0]);
      case "setAutoInitEnabled":
        return this.method("setAutoInitEnabled")({ enabled: args[0] === true });
      case "isAutoInitEnabled":
        return unwrapValue(this.method("isAutoInitEnabled")());
      case "stopJsEventBridge":
        return void 0;
      default:
        throw new import_errors.FCMError("invalid_argument", `Unknown FCM action "${action}"`, {
          platform: this.platformId
        });
    }
  }
  call(action, args = []) {
    return Promise.resolve().then(() => this.dispatch(action, args)).then((value) => value).catch((error) => {
      throw (0, import_errors.toFCMError)(
        "native_error",
        error,
        `Capacitor "${action}" failed`,
        this.platformId
      );
    });
  }
  addEventListener(listener, onTransportError) {
    let detached = false;
    const live = [];
    const removed = /* @__PURE__ */ new Set();
    const removeOnce = (handle) => {
      if (removed.has(handle)) {
        return;
      }
      removed.add(handle);
      void handle.remove().catch(() => void 0);
    };
    const adopt = (handle) => {
      if (detached) {
        removeOnce(handle);
      } else {
        live.push(handle);
      }
      return handle;
    };
    const notification = this.plugin.addListener("notification", (envelope) => {
      if (detached) {
        return;
      }
      listener({ kind: "notification", payload: envelope });
    }).then(adopt);
    const tokenRefresh = this.plugin.addListener("tokenRefresh", (event) => {
      if (detached) {
        return;
      }
      listener({ kind: "tokenRefresh", token: event?.token ?? "" });
    }).then(adopt);
    const pending = [notification, tokenRefresh];
    const settled = Promise.all(pending).then(() => void 0);
    settled.catch((error) => {
      onTransportError?.(
        (0, import_errors.toFCMError)(
          "bridge_unavailable",
          error,
          "Capacitor listener registration failed",
          this.platformId
        )
      );
    });
    this.registration = settled;
    return () => {
      detached = true;
      for (const handle of live) {
        removeOnce(handle);
      }
      for (const handle of pending) {
        void handle.then((resolved) => removeOnce(resolved)).catch(() => void 0);
      }
    };
  }
}
