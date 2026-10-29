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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var capacitor_exports = {};
__export(capacitor_exports, {
  CapacitorBridge: () => import_capacitorBridge2.CapacitorBridge,
  FCM: () => FCM,
  FCMCore: () => import_fcmCore.FCMCore,
  createCapacitorBridge: () => createCapacitorBridge,
  createFCM: () => createFCM,
  getNativePlugin: () => getNativePlugin
});
module.exports = __toCommonJS(capacitor_exports);
var import_fcmCore = require("../core/fcmCore.js");
var import_runtimeBridge = require("../core/runtimeBridge.js");
var import_capacitorBridge = require("../bridges/capacitorBridge.js");
var import_webBridge = require("../bridges/webBridge.js");
var import_capacitorBridge2 = require("../bridges/capacitorBridge.js");
class WebFCMPlugin {
  unsupported(method) {
    return Promise.reject(
      new Error(
        `FCMPlugin.${method} is not available on web: cordova-plugin-fcm-modern implements Android and iOS push only.`
      )
    );
  }
  ready() {
    return this.unsupported("ready");
  }
  replayBufferedEvents() {
    return this.unsupported("replayBufferedEvents");
  }
  setForegroundPresentation() {
    return this.unsupported("setForegroundPresentation");
  }
  getToken() {
    return this.unsupported("getToken");
  }
  deleteToken() {
    return this.unsupported("deleteToken");
  }
  getAPNSToken() {
    return this.unsupported("getAPNSToken");
  }
  getInitialPushPayload() {
    return this.unsupported("getInitialPushPayload");
  }
  hasPermission() {
    return this.unsupported("hasPermission");
  }
  requestPushPermission() {
    return this.unsupported("requestPushPermission");
  }
  subscribeToTopic() {
    return this.unsupported("subscribeToTopic");
  }
  unsubscribeFromTopic() {
    return this.unsupported("unsubscribeFromTopic");
  }
  clearAllNotifications() {
    return this.unsupported("clearAllNotifications");
  }
  createNotificationChannel() {
    return this.unsupported("createNotificationChannel");
  }
  addListener() {
    return Promise.resolve({ remove: () => Promise.resolve() });
  }
}
let registered = null;
const getNativePlugin = async (loader = () => import("@capacitor/core").then((core) => ({
  registerPlugin: core.registerPlugin
}))) => {
  if (registered !== null) {
    return registered;
  }
  const { registerPlugin } = await loader();
  registered = registerPlugin("FCMPlugin", {
    web: () => new WebFCMPlugin()
  });
  return registered;
};
const createCapacitorBridge = async () => {
  const plugin = await getNativePlugin();
  const platform = globalThis.Capacitor?.getPlatform?.();
  const platformId = platform === "android" || platform === "ios" ? platform : "unknown";
  if (platformId === "unknown" && platform === "web") {
    return new import_webBridge.WebBridge();
  }
  return new import_capacitorBridge.CapacitorBridge(plugin, platformId);
};
const capacitorPlatformId = () => {
  const platform = globalThis.Capacitor?.getPlatform?.();
  return platform === "android" || platform === "ios" || platform === "web" ? platform : "unknown";
};
const createFCM = (options = {}) => {
  const platformId = capacitorPlatformId();
  const bridge = new import_runtimeBridge.RuntimeBridge(
    async () => platformId === "web" ? new import_webBridge.WebBridge() : createCapacitorBridge(),
    { runtime: "capacitor", platformId }
  );
  return new import_fcmCore.FCMCore(bridge, options);
};
const FCM = createFCM();
