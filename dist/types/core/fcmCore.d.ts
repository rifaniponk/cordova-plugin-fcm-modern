import { CountingEventTarget } from './eventTarget.js';
import type { IChannelConfiguration, IDisposable, IFCMOptions, IForegroundPresentationOptions, INotificationPayload, IListenOptions, IPluginBridge, IRequestPushPermissionOptions, PlatformId } from './types.js';
/**
 * Runtime-agnostic FCM facade. Everything that is not transport lives here, so
 * Cordova, Capacitor and the tests share one implementation of the semantics.
 */
export declare class FCMCore {
    readonly eventTarget: CountingEventTarget;
    readonly platformId: PlatformId;
    private readonly notificationListeners;
    private readonly tokenListeners;
    private readonly notifications;
    private readonly tokens;
    private readonly options;
    private initPromise;
    private bridgeTeardown;
    /**
     * Bumped whenever the event stream is re-attached. A transport error callback
     * captured by an older generation can still arrive after its teardown ran;
     * the generation lets recovery ignore those stale callbacks instead of
     * tearing down the newer bridge.
     */
    private bridgeGeneration;
    private readonly attempts;
    private initialPayloadCache;
    private disposed;
    private readonly bridge;
    private readonly replayPending;
    constructor(bridge: IPluginBridge, options?: IFCMOptions & {
        callTimeoutMs?: number;
    });
    get platform(): PlatformId;
    /** Starts (or reuses) the native handshake. Safe to call repeatedly. */
    initialize(): Promise<void>;
    ready(): Promise<void>;
    /**
     * The event stream can die after the handshake settled (Cordova's keep-alive
     * error callback arrives whenever native drops the sink). `initPromise` is a
     * settled memo, so without recovery every later `ready`/`getToken` reports
     * success while there is no notification sink at all.
     *
     * Which of two shapes applies depends on whether the failing attempt has
     * already settled. While a handshake is still in flight the failure is
     * recorded for *that* attempt and fails its own promise (native answering
     * `ready` must not mask a dead sink); once it has settled there is no promise
     * left to fail, so recovery detaches, retires the memo and reattaches.
     */
    private handleStreamFailure;
    /** Detaches the stream of `generation` unless a newer attempt already owns it. */
    private retireAttempt;
    /**
     * The handshake proper. Kept separate from `initialize()` so the attempt's
     * bookkeeping — registering it, then marking it settled at its real
     * completion boundary — lives in one place.
     */
    private performHandshake;
    private runInitialization;
    private teardownBridge;
    /** Releases the bridge and all listeners. Idempotent. */
    dispose(): void;
    private subscriberCount;
    private handleNativeEvent;
    private emit;
    private deliverNotification;
    private deliverToken;
    private dispatch;
    /**
     * Replay is deferred to the next microtask so that attaching several listeners
     * in one tick replays to all of them, and so that disposing before the replay
     * runs means nothing is delivered at all.
     *
     * The queue is drained only as far as there are subscribers: a `once`
     * listener consumes one event and the rest stay buffered for the next
     * subscriber, rather than being silently swallowed.
     */
    private scheduleReplay;
    onNotification(callback: (payload: INotificationPayload) => void, options?: IListenOptions): IDisposable;
    onTokenRefresh(callback: (token: string) => void, options?: IListenOptions): IDisposable;
    private callNative;
    /**
     * Bounds a native promise by `callTimeoutMs`. The resulting error keeps the
     * distinct `timeout` code: "the native side never answered" is a different
     * diagnosis from "the bridge is offline" and must not be flattened.
     */
    private withTimeout;
    /**
     * Waits for an asynchronous native event registration (Capacitor) to settle
     * before `ready`/`replayBufferedEvents` run. Bridges without asynchronous
     * registration (Cordova's keep-alive callback) have nothing to wait for.
     */
    private awaitEventRegistration;
    /** Awaits initialization first, so callers never race the handshake. */
    private invoke;
    getToken(): Promise<string>;
    /** Deletes the current FCM registration token for this app instance. */
    deleteToken(): Promise<void>;
    /**
     * Compatibility alias for `deleteToken()`. In 7.x this name implied the
     * whole Firebase installation was removed; it only ever revoked the
     * messaging token, and 8.x keeps exactly that behaviour.
     */
    deleteInstanceId(): Promise<void>;
    getAPNSToken(): Promise<string>;
    getInitialPushPayload(): Promise<INotificationPayload | null>;
    hasPermission(): Promise<boolean>;
    requestPushPermission(options?: IRequestPushPermissionOptions): Promise<boolean>;
    subscribeToTopic(topic: string): Promise<void>;
    unsubscribeFromTopic(topic: string): Promise<void>;
    clearAllNotifications(): Promise<void>;
    /**
     * Turns Firebase's own auto-initialisation on or off. Explicit by design:
     * the host app owns the consent decision, the plugin never guesses it.
     */
    setAutoInitEnabled(enabled: boolean): Promise<void>;
    isAutoInitEnabled(): Promise<boolean>;
    createNotificationChannel(channelConfig: IChannelConfiguration): Promise<void>;
    /** Opt-in: by default foreground messages are event-only. */
    configureForegroundPresentation(options: IForegroundPresentationOptions): Promise<void>;
    /** Opt-in only: 7.x auto-subscribed to all/android/ios, 8.x never does. */
    setAutoSubscribeTopics(topics: string[]): void;
    private topicError;
    private assertTopic;
}
