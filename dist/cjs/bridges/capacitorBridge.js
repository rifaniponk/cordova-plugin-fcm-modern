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
    this.plugin = plugin;
    this.platformId = platformId;
  }
  async dispatch(action, args) {
    const plugin = this.plugin;
    const unwrapValue = async (call) => {
      const result = await call;
      return result?.value;
    };
    switch (action) {
      case "ready":
        return plugin.ready?.();
      case "replayBufferedEvents":
        return plugin.replayBufferedEvents?.();
      case "setForegroundPresentation":
        return plugin.setForegroundPresentation?.(args[0]);
      case "getToken":
        return unwrapValue(plugin.getToken?.());
      case "deleteToken":
        return plugin.deleteToken?.();
      case "getAPNSToken":
        return unwrapValue(plugin.getAPNSToken?.());
      case "getInitialPushPayload": {
        const result = await plugin.getInitialPushPayload?.();
        return result?.payload ?? null;
      }
      case "hasPermission":
        return unwrapValue(plugin.hasPermission?.());
      case "requestPushPermission":
        return unwrapValue(plugin.requestPushPermission?.(args[0]));
      case "subscribeToTopic":
        return plugin.subscribeToTopic?.(String(args[0]));
      case "unsubscribeFromTopic":
        return plugin.unsubscribeFromTopic?.(String(args[0]));
      case "clearAllNotifications":
        return plugin.clearAllNotifications?.();
      case "createNotificationChannel":
        return plugin.createNotificationChannel?.(args[0]);
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
    const handles = [];
    let detached = false;
    const pending = [];
    pending.push(
      this.plugin.addListener("notification", (envelope) => {
        if (detached) {
          return;
        }
        listener({ kind: "notification", payload: envelope });
      }).then((handle) => {
        handles.push(handle);
        if (detached) {
          void handle.remove().catch(() => void 0);
        }
        return handle;
      })
    );
    pending.push(
      this.plugin.addListener("tokenRefresh", (event) => {
        if (detached) {
          return;
        }
        listener({ kind: "tokenRefresh", token: event?.token ?? "" });
      }).then((handle) => {
        handles.push(handle);
        if (detached) {
          void handle.remove().catch(() => void 0);
        }
        return handle;
      })
    );
    for (const handle of pending) {
      handle.catch((error) => {
        onTransportError?.(
          (0, import_errors.toFCMError)(
            "bridge_unavailable",
            error,
            "Capacitor listener registration failed",
            this.platformId
          )
        );
      });
    }
    return () => {
      detached = true;
      for (const handle of handles) {
        void handle.remove().catch(() => void 0);
      }
      for (const handle of pending) {
        void handle.then((resolved) => resolved.remove()).catch(() => void 0);
      }
    };
  }
}
