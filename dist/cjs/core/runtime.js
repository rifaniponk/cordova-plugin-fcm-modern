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
var runtime_exports = {};
__export(runtime_exports, {
  detectRuntime: () => detectRuntime,
  isCapacitorHost: () => isCapacitorHost,
  isCordovaHost: () => isCordovaHost,
  readHost: () => readHost
});
module.exports = __toCommonJS(runtime_exports);
const readHost = () => {
  const global = globalThis;
  if (typeof global.window === "object" && global.window !== null) {
    return global.window;
  }
  if (global.Capacitor || global.cordova) {
    return { Capacitor: global.Capacitor, cordova: global.cordova };
  }
  return void 0;
};
const normalisePlatform = (value) => value === "android" || value === "ios" ? value : value === "browser" || value === "web" ? "web" : "unknown";
const isCapacitorHost = (host) => {
  if (host?.Capacitor === void 0) {
    return false;
  }
  const capacitor = host.Capacitor;
  if (typeof capacitor.isNativePlatform === "function" && capacitor.isNativePlatform()) {
    return true;
  }
  return typeof capacitor.Plugins?.FCMPlugin === "object";
};
const isCordovaHost = (host) => host?.cordova !== void 0 && typeof host.cordova.exec === "function";
const detectRuntime = () => {
  const host = readHost();
  if (isCapacitorHost(host)) {
    const platform = host?.Capacitor?.getPlatform?.();
    return { runtime: "capacitor", platformId: normalisePlatform(platform) };
  }
  if (isCordovaHost(host)) {
    return { runtime: "cordova", platformId: normalisePlatform(host?.cordova?.platformId) };
  }
  return { runtime: "web", platformId: "web" };
};
