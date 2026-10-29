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
var v4_exports = {};
__export(v4_exports, {
  FCM: () => FCM,
  provideFCM: () => provideFCM
});
module.exports = __toCommonJS(v4_exports);
var import_shared = require("../shared.js");
__reExport(v4_exports, require("../shared.js"), module.exports);
__reExport(v4_exports, require("../../core/index.js"), module.exports);
class FCM extends import_shared.FCMIonicBase {
  constructor(options = {}) {
    super(options);
  }
}
const provideFCM = (options = {}) => ({
  provide: FCM,
  useFactory: () => new FCM(options)
});
