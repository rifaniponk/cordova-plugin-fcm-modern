import { Observable } from 'rxjs';
import { FCMCore } from '../core/fcmCore.js';
import { RuntimeBridge } from '../core/runtimeBridge.js';
import { sharedFCM } from '../core/instance.js';
import { loadBridge } from '../core/loadBridge.js';
/**
 * RxJS is imported statically, and only inside the `ionic` subpath graph.
 *
 * That is the whole peer contract: a consumer of `cordova-plugin-fcm-modern/ionic`
 * installs `rxjs`, while consumers of the root/core/cordova/capacitor entries never
 * import this module and therefore stay peer-free. The lazy `require('rxjs')` the
 * first draft used is gone — it produced a fake observable surface, broke under ESM
 * (no `require`) and made `pipe`/`take`/teardown semantics untestable. A real
 * `Observable` is what 7.x returned, so 7.x upgrade paths keep compiling.
 */
/**
 * Attaches one native listener per subscription and releases it on teardown.
 *
 * The handle is stored through a closure cell rather than a local because the core
 * replays buffered events from a microtask: an event can be delivered before
 * `onNotification()` has returned, so the unsubscribe path must still find (and
 * dispose) the handle that arrives late. Teardown is exactly-once and safe even if
 * the observable was already completed by `once` semantics.
 */
const eventObservable = (listen, options) => new Observable((observer) => {
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
        // A `once` listener is dead the moment it fires, so its native handle
        // goes with it; that also keeps the core's listener count honest.
        if (options.once === true) {
            release();
            observer.complete();
        }
    }, options);
    // rxjs can complete the subscriber synchronously inside the subscribe
    // teardown path (`take(1)` over an already-empty source, or an immediate
    // unsubscribe). If that happened before the handle existed, dispose now.
    if (observer.closed) {
        release();
    }
    return release;
});
/** The Ionic wrappers never build their own FCMCore — see docs/BRIDGE-CONTRACT.md. */
export const ionicFCM = (options = {}) => sharedFCM(() => new FCMCore(new RuntimeBridge(loadBridge), options));
/**
 * The 7.x Ionic class. Method names and option shapes are kept; the imperative
 * calls delegate to the shared core, so its validation, timeouts and error codes
 * stay the ones under test in tests/fcmCore.test.ts.
 */
export class FCMIonicBase {
    fcm;
    /** Zero-arg by default: Angular can construct it before any factory runs. */
    constructor(options = {}) {
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
        return eventObservable((callback, listenOptions) => this.fcm.onNotification(callback, listenOptions), options ?? {});
    }
    /** Event firing when receiving a new Firebase token — 7.x signature. */
    onTokenRefresh(options) {
        return eventObservable((callback, listenOptions) => this.fcm.onTokenRefresh(callback, listenOptions), options ?? {});
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
