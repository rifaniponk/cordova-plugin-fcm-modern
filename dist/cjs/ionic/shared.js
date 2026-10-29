"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
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
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var shared_exports = {};
__export(shared_exports, {
  FCMIonicBase: () => FCMIonicBase,
  ionicFCM: () => ionicFCM
});
module.exports = __toCommonJS(shared_exports);
var import_rxjs = require("rxjs");
var import_fcmCore = require("../core/fcmCore.js");
var import_runtimeBridge = require("../core/runtimeBridge.js");
var import_instance = require("../core/instance.js");
var import_loadBridge = require("../core/loadBridge.js");
const eventObservable = (listen, options) => new import_rxjs.Observable((observer) => {
  let handle = null;
  let released = false;
  const release = () => {
    if (!released && handle !== null) {
      released = true;
      handle.dispose();
      handle = null;
    }
  };
  handle = listen((value) => {
    observer.next(value);
    if (options.once === true) {
      release();
      observer.complete();
    }
  }, options);
  if (observer.closed) {
    release();
  }
  return release;
});
const ionicFCM = (options = {}) => (0, import_instance.sharedFCM)(() => new import_fcmCore.FCMCore(new import_runtimeBridge.RuntimeBridge(import_loadBridge.loadBridge), options));
class FCMIonicBase {
  /** Zero-arg by default: Angular can construct it before any factory runs. */
  constructor(options = {}) {
    __publicField(this, "fcm");
    this.fcm = ionicFCM(options);
  }
  /** The shared core this wrapper drives — also what `provideFCM()` injects. */
  get core() {
    return this.fcm;
  }
  initialize() {
    return this.fcm.initialize();
  }
  ready() {
    return this.fcm.ready();
  }
  dispose() {
    this.fcm.dispose();
  }
  getToken() {
    return this.fcm.getToken();
  }
  deleteToken() {
    return this.fcm.deleteToken();
  }
  deleteInstanceId() {
    return this.fcm.deleteInstanceId();
  }
  getAPNSToken() {
    return this.fcm.getAPNSToken();
  }
  getInitialPushPayload() {
    return this.fcm.getInitialPushPayload();
  }
  hasPermission() {
    return this.fcm.hasPermission();
  }
  requestPushPermission(options = {}) {
    return this.fcm.requestPushPermission(options);
  }
  subscribeToTopic(topic) {
    return this.fcm.subscribeToTopic(topic);
  }
  unsubscribeFromTopic(topic) {
    return this.fcm.unsubscribeFromTopic(topic);
  }
  clearAllNotifications() {
    return this.fcm.clearAllNotifications();
  }
  createNotificationChannel(channelConfig) {
    return this.fcm.createNotificationChannel(channelConfig);
  }
  setAutoInitEnabled(enabled) {
    return this.fcm.setAutoInitEnabled(enabled);
  }
  isAutoInitEnabled() {
    return this.fcm.isAutoInitEnabled();
  }
  /** Additive in 8.x: opt-in foreground presentation of a notification. */
  configureForegroundPresentation(options) {
    return this.fcm.configureForegroundPresentation(options);
  }
  /** Additive in 8.x: subscribe on the next successful initialization. */
  setAutoSubscribeTopics(topics) {
    this.fcm.setAutoSubscribeTopics(topics);
  }
  /**
   * Event firing when receiving new notifications — the 7.x signature, kept
   * verbatim so an Ionic upgrade is a version bump, not a rewrite.
   */
  onNotification(options) {
    return eventObservable(
      (callback, listenOptions) => this.fcm.onNotification(callback, listenOptions),
      options ?? {}
    );
  }
  /** Event firing when receiving a new Firebase token — 7.x signature. */
  onTokenRefresh(options) {
    return eventObservable(
      (callback, listenOptions) => this.fcm.onTokenRefresh(callback, listenOptions),
      options ?? {}
    );
  }
  /** Additive alias of `onNotification()`; kept optional-by-design. */
  notification(options) {
    return this.onNotification(options);
  }
  /** Additive alias of `onTokenRefresh()`. */
  tokenRefresh(options) {
    return this.onTokenRefresh(options);
  }
  /**
   * Imperative escape hatch for plain JS consumers of the Ionic build: the core
   * callback form, handle returned. It is a different name on purpose — 7.x bound
   * `onNotification` to an Observable and overloading it by argument type would
   * break `pipe()` chains.
   */
  addNotificationListener(callback, options = {}) {
    return this.fcm.onNotification(callback, options);
  }
  /** Imperative form of the token stream; see `addNotificationListener`. */
  addTokenRefreshListener(callback, options = {}) {
    return this.fcm.onTokenRefresh(callback, options);
  }
}
