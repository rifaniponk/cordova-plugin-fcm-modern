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
var ionic_exports = {};
__export(ionic_exports, {
  FCM: () => FCM,
  FCMIonicBase: () => import_shared2.FCMIonicBase,
  FCMPluginOnIonic: () => FCMPluginOnIonic,
  ionicFCM: () => import_shared2.ionicFCM
});
module.exports = __toCommonJS(ionic_exports);
var import_shared = require("./shared.js");
__reExport(ionic_exports, require("../index.js"), module.exports);
var import_shared2 = require("./shared.js");
class FCMPluginOnIonic extends import_shared.FCMIonicBase {
  constructor(options = {}) {
    super(options);
  }
}
const FCM = new FCMPluginOnIonic();
