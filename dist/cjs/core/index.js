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
var core_exports = {};
__export(core_exports, {
  FCMCore: () => import_fcmCore.FCMCore,
  FCMError: () => import_errors.FCMError,
  FCMPlugin: () => import_fcmCore.FCMCore,
  FCM_ERROR_CODES: () => import_errors.FCM_ERROR_CODES,
  isFCMError: () => import_errors.isFCMError,
  sharedFCM: () => import_instance.sharedFCM,
  sharedFCMKey: () => import_instance.sharedFCMKey,
  toFCMError: () => import_errors.toFCMError
});
module.exports = __toCommonJS(core_exports);
var import_errors = require("./errors.js");
var import_fcmCore = require("./fcmCore.js");
var import_instance = require("./instance.js");
