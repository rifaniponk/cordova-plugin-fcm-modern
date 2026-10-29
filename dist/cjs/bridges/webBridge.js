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
var webBridge_exports = {};
__export(webBridge_exports, {
  WebBridge: () => WebBridge
});
module.exports = __toCommonJS(webBridge_exports);
var import_errors = require("../core/errors.js");
class WebBridge {
  constructor() {
    __publicField(this, "runtime", "web");
    __publicField(this, "platformId", "web");
  }
  call(action) {
    return Promise.reject(
      new import_errors.FCMError(
        "unsupported_platform",
        `FCM action "${action}" is unavailable on the web platform: this plugin implements Android and iOS push only. Serve web push from your own service worker instead.`,
        { platform: this.platformId }
      )
    );
  }
  addEventListener() {
    return () => void 0;
  }
}
