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
var index_exports = {};
__export(index_exports, {
  FCM: () => FCM,
  FCMCore: () => import_fcmCore2.FCMCore,
  RuntimeBridge: () => import_runtimeBridge2.RuntimeBridge,
  createFCM: () => createFCM,
  default: () => index_default,
  loadBridge: () => import_loadBridge2.loadBridge
});
module.exports = __toCommonJS(index_exports);
var import_fcmCore = require("./core/fcmCore.js");
var import_runtimeBridge = require("./core/runtimeBridge.js");
var import_instance = require("./core/instance.js");
var import_loadBridge = require("./core/loadBridge.js");
var import_cordovaBridge = require("./bridges/cordovaBridge.js");
__reExport(index_exports, require("./core/index.js"), module.exports);
var import_fcmCore2 = require("./core/fcmCore.js");
var import_runtimeBridge2 = require("./core/runtimeBridge.js");
var import_loadBridge2 = require("./core/loadBridge.js");
const createFCM = (options = {}) => new import_fcmCore.FCMCore(new import_runtimeBridge.RuntimeBridge(import_loadBridge.loadBridge), options);
const FCM = (0, import_instance.sharedFCM)(() => new import_fcmCore.FCMCore(new import_runtimeBridge.RuntimeBridge(import_loadBridge.loadBridge)));
var index_default = FCM;
