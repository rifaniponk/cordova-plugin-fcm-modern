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
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var cordova_exports = {};
__export(cordova_exports, {
  CordovaBridge: () => import_cordovaBridge2.CordovaBridge,
  FCM: () => FCM,
  FCMCore: () => import_fcmCore2.FCMCore,
  createFCM: () => createFCM,
  default: () => cordova_default,
  getCordovaHost: () => import_cordovaBridge2.getCordovaHost
});
module.exports = __toCommonJS(cordova_exports);
var import_fcmCore = require("../core/fcmCore.js");
var import_cordovaBridge = require("../bridges/cordovaBridge.js");
var import_cordovaBridge2 = require("../bridges/cordovaBridge.js");
var import_fcmCore2 = require("../core/fcmCore.js");
__reExport(cordova_exports, require("../core/index.js"), module.exports);
const createFCM = (options = {}) => new import_fcmCore.FCMCore(import_cordovaBridge.CordovaBridge.create(), options);
const FCM = createFCM();
const host = globalThis;
if (typeof host.window === "object" && host.window !== null && (0, import_cordovaBridge.getCordovaHost)() !== null) {
  host.window.FCM = FCM;
}
var cordova_default = FCM;
