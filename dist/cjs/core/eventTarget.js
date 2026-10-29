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
class CountingEventTarget extends EventTarget {
  constructor() {
    super(...arguments);
    __publicField(this, "counts", /* @__PURE__ */ new Map());
  }
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    if (type === NOTIFICATION_EVENT || type === TOKEN_REFRESH_EVENT) {
      this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
    }
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    if (type === NOTIFICATION_EVENT || type === TOKEN_REFRESH_EVENT) {
      const next = (this.counts.get(type) ?? 0) - 1;
      if (next > 0) {
        this.counts.set(type, next);
      } else {
        this.counts.delete(type);
      }
    }
  }
  subscriberCount(type) {
    return this.counts.get(type) ?? 0;
  }
}
