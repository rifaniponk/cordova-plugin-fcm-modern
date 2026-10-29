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
var errors_exports = {};
__export(errors_exports, {
  FCMError: () => FCMError,
  FCM_ERROR_CODES: () => FCM_ERROR_CODES,
  isFCMError: () => isFCMError,
  toFCMError: () => toFCMError
});
module.exports = __toCommonJS(errors_exports);
const FCM_ERROR_CODES = [
  "unsupported_platform",
  "bridge_unavailable",
  "invalid_argument",
  "native_error",
  "timeout",
  "not_initialized"
];
class FCMError extends Error {
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
}
const isFCMError = (value) => value instanceof FCMError || typeof value === "object" && value !== null && value.name === "FCMError" && typeof value.code === "string";
const toFCMError = (code, raw, fallbackMessage, platform) => {
  if (isFCMError(raw)) {
    return raw;
  }
  if (raw instanceof Error) {
    return new FCMError(code, raw.message || fallbackMessage, { platform, cause: raw });
  }
  if (typeof raw === "string" && raw.length > 0) {
    return new FCMError(code, raw, { platform, cause: raw });
  }
  if (typeof raw === "object" && raw !== null) {
    const record = raw;
    const message = typeof record.message === "string" && record.message.length > 0 ? record.message : fallbackMessage;
    return new FCMError(code, message, { platform, cause: record.cause ?? raw });
  }
  return new FCMError(code, fallbackMessage, { platform, cause: raw });
};
