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
    __publicField(this, "resolvedInner", null);
    __publicField(this, "pendingListener", null);
    __publicField(this, "pendingErrorHandler");
    __publicField(this, "innerTeardown", null);
    __publicField(this, "detached", true);
    __publicField(this, "loader");
    this.loader = loader;
    const detectedRuntime = detected ?? (0, import_runtime2.detectRuntime)();
    this.runtime = detectedRuntime.runtime;
    this.platformId = detectedRuntime.platformId;
  }
  resolveBridge() {
    if (this.inner === null) {
      const pending = this.loader(this.runtime).then(
        (bridge) => {
          this.resolvedInner = bridge;
          this.attach();
          return bridge;
        },
        (error) => {
          if (this.inner === pending) {
            this.inner = null;
          }
          throw error;
        }
      );
      this.inner = pending;
    }
    return this.inner;
  }
  /**
   * Attaches the pending listener to whichever bridge object is live right now.
   * Called both after the bridge resolves and when a listener attaches to an
   * already-resolved bridge. Without that second path a core that retried a
   * failed handshake would keep talking to a native transport that has no sink
   * attached, so every cold-start event after the retry would be lost.
   */
  attach() {
    if (this.detached || this.pendingListener === null || this.resolvedInner === null) {
      return;
    }
    if (this.innerTeardown !== null) {
      return;
    }
    this.innerTeardown = this.resolvedInner.addEventListener(
      this.pendingListener,
      this.pendingErrorHandler
    );
  }
  call(action, args = []) {
    return this.resolveBridge().then((bridge) => bridge.call(action, args));
  }
  addEventListener(listener, onError) {
    this.pendingListener = listener;
    this.pendingErrorHandler = onError;
    this.detached = false;
    this.attach();
    return () => {
      this.detached = true;
      this.pendingListener = null;
      if (this.innerTeardown !== null) {
        this.innerTeardown();
        this.innerTeardown = null;
      }
    };
  }
  /**
   * Forwards Capacitor's asynchronous listener registration. Resolving the
   * inner bridge is part of the wait: registration cannot even start before the
   * native plugin object exists.
   */
  waitForEventRegistration() {
    return this.resolveBridge().then((bridge) => bridge.waitForEventRegistration?.());
  }
  /** Exposed for tests and diagnostics; never used to make a promise pend. */
  bridgeState() {
    return {
      resolved: this.resolvedInner !== null,
      runtime: this.runtime,
      platformId: this.platformId
    };
  }
}
