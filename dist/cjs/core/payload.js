"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var payload_exports = {};
__export(payload_exports, {
  RESERVED_KEYS: () => RESERVED_KEYS,
  UNSAFE_KEYS: () => UNSAFE_KEYS,
  extractMessageId: () => extractMessageId,
  sanitizeNotificationPayload: () => sanitizeNotificationPayload
});
module.exports = __toCommonJS(payload_exports);
const RESERVED_KEYS = [
  "wasTapped",
  "title",
  "subtitle",
  "body",
  "badge",
  "messageId",
  "custom",
  "_fcm"
];
const UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const safeKey = (key) => !UNSAFE_KEYS.includes(key);
const assign = (target, key, value) => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });
};
const asText = (value) => typeof value === "string" ? value : typeof value === "number" ? String(value) : void 0;
const asCount = (value) => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : void 0;
};
const extractMessageId = (raw) => {
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
const sanitizeNotificationPayload = (raw) => {
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
