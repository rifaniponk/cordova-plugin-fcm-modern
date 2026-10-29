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
var cordovaBridge_exports = {};
__export(cordovaBridge_exports, {
  BRIDGE_SERVICE: () => BRIDGE_SERVICE,
  CordovaBridge: () => CordovaBridge,
  getCordovaHost: () => getCordovaHost,
  parseNativeEnvelope: () => parseNativeEnvelope
});
module.exports = __toCommonJS(cordovaBridge_exports);
var import_errors = require("../core/errors.js");
var import_runtime2 = require("../core/runtime.js");
const BRIDGE_SERVICE = "FCMPlugin";
const getCordovaHost = () => {
  const host = (0, import_runtime2.readHost)();
  const cordova = host?.cordova;
  if (cordova && typeof cordova.exec === "function") {
    return cordova;
  }
  return null;
};
const normalisePlatform = (value) => value === "android" || value === "ios" ? value : "unknown";
const parseNativeEnvelope = (raw) => {
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
class CordovaBridge {
  constructor(cordova, platformId) {
    __publicField(this, "runtime", "cordova");
    __publicField(this, "platformId");
    __publicField(this, "attached", false);
    __publicField(this, "cordova");
    this.cordova = cordova;
    this.platformId = platformId ?? normalisePlatform(cordova?.platformId);
  }
  static create(platformId) {
    return new CordovaBridge(getCordovaHost(), platformId);
  }
  call(action, args = []) {
    const cordova = this.cordova;
    if (cordova === null) {
      return Promise.reject(
        new import_errors.FCMError(
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
            (0, import_errors.toFCMError)(
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
          (0, import_errors.toFCMError)(
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
      onTransportError?.(new import_errors.FCMError(code, message, { platform: this.platformId, cause }));
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
        (0, import_errors.toFCMError)(
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
        (0, import_errors.toFCMError)(
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
}
