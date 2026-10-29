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
var instance_exports = {};
__export(instance_exports, {
  resetSharedFCM: () => resetSharedFCM,
  sharedFCM: () => sharedFCM,
  sharedFCMKey: () => sharedFCMKey
});
module.exports = __toCommonJS(instance_exports);
const SHARED_INSTANCE_KEY = /* @__PURE__ */ Symbol.for("cordova-plugin-fcm-modern.fcm.instance");
const sharedFCM = (create) => {
  const host = globalThis;
  const existing = host[SHARED_INSTANCE_KEY];
  if (existing !== void 0) {
    return existing;
  }
  const created = create();
  host[SHARED_INSTANCE_KEY] = created;
  return created;
};
const sharedFCMKey = SHARED_INSTANCE_KEY;
const resetSharedFCM = () => {
  const host = globalThis;
  delete host[SHARED_INSTANCE_KEY];
};
