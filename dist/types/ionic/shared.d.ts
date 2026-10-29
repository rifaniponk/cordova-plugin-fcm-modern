import { Observable } from 'rxjs';
import { FCMCore } from '../core/fcmCore.js';
import type { IDisposable, IFCMOptions, IListenOptions, INotificationPayload } from '../core/types.js';
/** The Ionic wrappers never build their own FCMCore — see docs/BRIDGE-CONTRACT.md. */
export declare const ionicFCM: (options?: IFCMOptions) => FCMCore;
/**
 * The 7.x Ionic class. Method names and option shapes are kept; the imperative
 * calls delegate to the shared core, so its validation, timeouts and error codes
 * stay the ones under test in tests/fcmCore.test.ts.
 */
export declare class FCMIonicBase {
    protected readonly fcm: FCMCore;
    /** Zero-arg by default: Angular can construct it before any factory runs. */
    constructor(options?: IFCMOptions);
    /** The shared core this wrapper drives — also what `provideFCM()` injects. */
    get core(): FCMCore;
    initialize(): Promise<void>;
    ready(): Promise<void>;
    dispose(): void;
    getToken(): Promise<string>;
    deleteToken(): Promise<void>;
    deleteInstanceId(): Promise<void>;
    getAPNSToken(): Promise<string>;
    getInitialPushPayload(): Promise<INotificationPayload | null>;
    hasPermission(): Promise<boolean>;
    requestPushPermission(options?: Parameters<FCMCore['requestPushPermission']>[0]): Promise<boolean>;
    subscribeToTopic(topic: string): Promise<void>;
    unsubscribeFromTopic(topic: string): Promise<void>;
    clearAllNotifications(): Promise<void>;
    createNotificationChannel(channelConfig: Parameters<FCMCore['createNotificationChannel']>[0]): Promise<void>;
    setAutoInitEnabled(enabled: boolean): Promise<void>;
    isAutoInitEnabled(): Promise<boolean>;
    /** Additive in 8.x: opt-in foreground presentation of a notification. */
    configureForegroundPresentation(options: Parameters<FCMCore['configureForegroundPresentation']>[0]): Promise<void>;
    /** Additive in 8.x: subscribe on the next successful initialization. */
    setAutoSubscribeTopics(topics: string[]): void;
    /**
     * Event firing when receiving new notifications — the 7.x signature, kept
     * verbatim so an Ionic upgrade is a version bump, not a rewrite.
     */
    onNotification(options?: {
        once?: boolean;
    }): Observable<INotificationPayload>;
    /** Event firing when receiving a new Firebase token — 7.x signature. */
    onTokenRefresh(options?: {
        once?: boolean;
    }): Observable<string>;
    /** Additive alias of `onNotification()`; kept optional-by-design. */
    notification(options?: {
        once?: boolean;
    }): Observable<INotificationPayload>;
    /** Additive alias of `onTokenRefresh()`. */
    tokenRefresh(options?: {
        once?: boolean;
    }): Observable<string>;
    /**
     * Imperative escape hatch for plain JS consumers of the Ionic build: the core
     * callback form, handle returned. It is a different name on purpose — 7.x bound
     * `onNotification` to an Observable and overloading it by argument type would
     * break `pipe()` chains.
     */
    addNotificationListener(callback: (payload: INotificationPayload) => void, options?: IListenOptions): IDisposable;
    /** Imperative form of the token stream; see `addNotificationListener`. */
    addTokenRefreshListener(callback: (token: string) => void, options?: IListenOptions): IDisposable;
}
