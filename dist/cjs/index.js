"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  FCM: () => FCM,
  FCMCore: () => import_fcmCore2.FCMCore,
  RuntimeBridge: () => import_runtimeBridge2.RuntimeBridge,
  createFCM: () => createFCM,
  default: () => index_default,
  loadBridge: () => loadBridge
});
module.exports = __toCommonJS(index_exports);
var import_fcmCore = require("./core/fcmCore.js");
var import_runtimeBridge = require("./core/runtimeBridge.js");
var import_cordovaBridge = require("./bridges/cordovaBridge.js");
var import_webBridge = require("./bridges/webBridge.js");
__reExport(index_exports, require("./core/index.js"), module.exports);
var import_fcmCore2 = require("./core/fcmCore.js");
var import_runtimeBridge2 = require("./core/runtimeBridge.js");
const loadBridge = async (runtime) => {
  if (runtime === "cordova") {
    return import_cordovaBridge.CordovaBridge.create();
  }
  if (runtime === "capacitor") {
    const capacitor = await import("./capacitor/index.js");
    return capacitor.createCapacitorBridge();
  }
  return new import_webBridge.WebBridge();
};
const createFCM = (options = {}) => new import_fcmCore.FCMCore(new import_runtimeBridge.RuntimeBridge(loadBridge), options);
const FCM = createFCM();
var index_default = FCM;
