import { Observable } from 'rxjs'
import { FCMCore } from '../core/fcmCore.js'
import { RuntimeBridge } from '../core/runtimeBridge.js'
import { sharedFCM } from '../core/instance.js'
import { loadBridge } from '../core/loadBridge.js'
import type {
    IDisposable,
    IFCMOptions,
    IListenOptions,
    INotificationPayload
} from '../core/types.js'

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
const eventObservable = <T>(
    listen: (callback: (value: T) => void, options: IListenOptions) => IDisposable,
    options: IListenOptions
): Observable<T> =>
    new Observable<T>((observer) => {
        let handle: IDisposable | null = null
        let released = false
        const release = (): void => {
            if (!released && handle !== null) {
                released = true
                handle.dispose()
                handle = null
            }
        }
        handle = listen((value: T) => {
            observer.next(value)
            // A `once` listener is dead the moment it fires, so its native handle
            // goes with it; that also keeps the core's listener count honest.
            if (options.once === true) {
                release()
                observer.complete()
            }
        }, options)
        // rxjs can complete the subscriber synchronously inside the subscribe
        // teardown path (`take(1)` over an already-empty source, or an immediate
        // unsubscribe). If that happened before the handle existed, dispose now.
        if (observer.closed) {
            release()
        }
        return release
    })

/** The Ionic wrappers never build their own FCMCore — see docs/BRIDGE-CONTRACT.md. */
export const ionicFCM = (options: IFCMOptions = {}): FCMCore =>
    sharedFCM(() => new FCMCore(new RuntimeBridge(loadBridge), options))

/**
 * The 7.x Ionic class. Method names and option shapes are kept; the imperative
 * calls delegate to the shared core, so its validation, timeouts and error codes
 * stay the ones under test in tests/fcmCore.test.ts.
 */
export class FCMIonicBase {
    protected readonly fcm: FCMCore

    /** Zero-arg by default: Angular can construct it before any factory runs. */
    constructor(options: IFCMOptions = {}) {
        this.fcm = ionicFCM(options)
    }

    /** The shared core this wrapper drives — also what `provideFCM()` injects. */
    public get core(): FCMCore {
        return this.fcm
    }

    public initialize(): Promise<void> {
        return this.fcm.initialize()
    }

    public ready(): Promise<void> {
        return this.fcm.ready()
    }

    public dispose(): void {
        this.fcm.dispose()
    }

    public getToken(): Promise<string> {
        return this.fcm.getToken()
    }

    public deleteToken(): Promise<void> {
        return this.fcm.deleteToken()
    }

    public deleteInstanceId(): Promise<void> {
        return this.fcm.deleteInstanceId()
    }

    public getAPNSToken(): Promise<string> {
        return this.fcm.getAPNSToken()
    }

    public getInitialPushPayload(): Promise<INotificationPayload | null> {
        return this.fcm.getInitialPushPayload()
    }

    public hasPermission(): Promise<boolean> {
        return this.fcm.hasPermission()
    }

    public requestPushPermission(
        options: Parameters<FCMCore['requestPushPermission']>[0] = {}
    ): Promise<boolean> {
        return this.fcm.requestPushPermission(options)
    }

    public subscribeToTopic(topic: string): Promise<void> {
        return this.fcm.subscribeToTopic(topic)
    }

    public unsubscribeFromTopic(topic: string): Promise<void> {
        return this.fcm.unsubscribeFromTopic(topic)
    }

    public clearAllNotifications(): Promise<void> {
        return this.fcm.clearAllNotifications()
    }

    public createNotificationChannel(
        channelConfig: Parameters<FCMCore['createNotificationChannel']>[0]
    ): Promise<void> {
        return this.fcm.createNotificationChannel(channelConfig)
    }

    public setAutoInitEnabled(enabled: boolean): Promise<void> {
        return this.fcm.setAutoInitEnabled(enabled)
    }

    public isAutoInitEnabled(): Promise<boolean> {
        return this.fcm.isAutoInitEnabled()
    }

    /** Additive in 8.x: opt-in foreground presentation of a notification. */
    public configureForegroundPresentation(
        options: Parameters<FCMCore['configureForegroundPresentation']>[0]
    ): Promise<void> {
        return this.fcm.configureForegroundPresentation(options)
    }

    /** Additive in 8.x: subscribe on the next successful initialization. */
    public setAutoSubscribeTopics(topics: string[]): void {
        this.fcm.setAutoSubscribeTopics(topics)
    }

    /**
     * Event firing when receiving new notifications — the 7.x signature, kept
     * verbatim so an Ionic upgrade is a version bump, not a rewrite.
     */
    public onNotification(options?: { once?: boolean }): Observable<INotificationPayload> {
        return eventObservable<INotificationPayload>(
            (callback, listenOptions) => this.fcm.onNotification(callback, listenOptions),
            options ?? {}
        )
    }

    /** Event firing when receiving a new Firebase token — 7.x signature. */
    public onTokenRefresh(options?: { once?: boolean }): Observable<string> {
        return eventObservable<string>(
            (callback, listenOptions) =>
                this.fcm.onTokenRefresh(callback as (token: string) => void, listenOptions),
            options ?? {}
        )
    }

    /** Additive alias of `onNotification()`; kept optional-by-design. */
    public notification(options?: { once?: boolean }): Observable<INotificationPayload> {
        return this.onNotification(options)
    }

    /** Additive alias of `onTokenRefresh()`. */
    public tokenRefresh(options?: { once?: boolean }): Observable<string> {
        return this.onTokenRefresh(options)
    }

    /**
     * Imperative escape hatch for plain JS consumers of the Ionic build: the core
     * callback form, handle returned. It is a different name on purpose — 7.x bound
     * `onNotification` to an Observable and overloading it by argument type would
     * break `pipe()` chains.
     */
    public addNotificationListener(
        callback: (payload: INotificationPayload) => void,
        options: IListenOptions = {}
    ) {
        return this.fcm.onNotification(callback, options)
    }

    /** Imperative form of the token stream; see `addNotificationListener`. */
    public addTokenRefreshListener(
        callback: (token: string) => void,
        options: IListenOptions = {}
    ) {
        return this.fcm.onTokenRefresh(callback, options)
    }
}
