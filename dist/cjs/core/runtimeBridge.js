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
var runtimeBridge_exports = {};
__export(runtimeBridge_exports, {
  RuntimeBridge: () => RuntimeBridge
});
module.exports = __toCommonJS(runtimeBridge_exports);
var import_runtime2 = require("./runtime.js");
class RuntimeBridge {
  constructor(loader, detected) {
    __publicField(this, "runtime");
    __publicField(this, "platformId");
    __publicField(this, "inner", null);
    __publicField(this, "pendingListener", null);
    __publicField(this, "pendingErrorHandler");
    __publicField(this, "innerTeardown", null);
    __publicField(this, "detached", false);
    __publicField(this, "loader");
    this.loader = loader;
    const detectedRuntime = detected ?? (0, import_runtime2.detectRuntime)();
    this.runtime = detectedRuntime.runtime;
    this.platformId = detectedRuntime.platformId;
  }
  resolveBridge() {
    if (this.inner === null) {
      this.inner = this.loader(this.runtime).then((bridge) => {
        if (this.detached) {
          return bridge;
        }
        if (this.pendingListener !== null) {
          this.innerTeardown = bridge.addEventListener(
            this.pendingListener,
            this.pendingErrorHandler
          );
        }
        return bridge;
      });
    }
    return this.inner;
  }
  call(action, args = []) {
    return this.resolveBridge().then((bridge) => bridge.call(action, args));
  }
  addEventListener(listener, onError) {
    this.pendingListener = listener;
    this.pendingErrorHandler = onError;
    this.detached = false;
    return () => {
      this.detached = true;
      this.pendingListener = null;
      if (this.innerTeardown !== null) {
        this.innerTeardown();
        this.innerTeardown = null;
      }
    };
  }
  /** Exposed for tests and diagnostics; never used to make a promise pend. */
  bridgeState() {
    return { resolved: this.inner !== null, runtime: this.runtime, platformId: this.platformId };
  }
}
