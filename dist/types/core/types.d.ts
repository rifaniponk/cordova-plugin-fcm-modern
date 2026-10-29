/**
 * Public type contract shared by every runtime adapter.
 * Names keep the legacy 7.x spelling where the API name is preserved.
 */
import type { FCMError } from './errors.js';
export type PlatformId = 'android' | 'ios' | 'web' | 'unknown';
export type RuntimeId = 'cordova' | 'capacitor' | 'web';
export interface IDisposable {
    dispose(): void;
}
export interface IChannelConfiguration {
    /** Channel id, used in the android_channel_id push payload key */
    id: string;
    /** Channel name, visible to the user */
    name: string;
    /** Channel description, visible to the user */
    description?: string;
    /**
     * Importance for notifications of this channel
     * https://developer.android.com/guide/topics/ui/notifiers/notifications#importance
     */
    importance?: 'none' | 'min' | 'low' | 'default' | 'high';
    /**
     * Visibility for notifications of this channel
     * https://developer.android.com/training/notify-user/build-notification#lockscreenNotification
     */
    visibility?: 'public' | 'private' | 'secret';
    /**
     * Default sound resource for this channel. The file must live at
     * res/raw/[resource name].mp3 in the app project.
     */
    sound?: string;
    /** Enable notification LED for this channel */
    lights?: boolean;
    /** Enable vibration for this channel */
    vibration?: boolean;
}
/**
 * `ios9Support` is accepted for source compatibility with 7.x callers and is
 * ignored: 8.x has no iOS 9 code path.
 */
export interface IRequestPushPermissionOptions {
    /** @deprecated Ignored since 8.0.0 — kept so 7.x call sites still compile. */
    ios9Support?: {
        /** @deprecated Ignored since 8.0.0. */
        timeout?: number;
        /** @deprecated Ignored since 8.0.0. */
        interval?: number;
    };
    /**
     * iOS only: request non-authorizing ("provisional") delivery to the
     * notification centre without a modal prompt.
     */
    provisional?: boolean;
}
/**
 * Opt-in foreground presentation. Absent means "event only": a notification
 * that arrives while the app is foregrounded is delivered to JS listeners and
 * is *not* displayed by the OS.
 */
export interface IForegroundPresentationOptions {
    alert?: boolean;
    sound?: boolean;
    badge?: boolean;
    /**
     * Android only: notification channel to present foreground messages on.
     * Defaults to the plugin default channel when presentation is enabled.
     */
    channelId?: string;
}
/**
 * A delivered message. `wasTapped`/`title`/`subtitle`/`body`/`badge`/`messageId`
 * are trusted native metadata and are never overwritten by message `data`.
 * A `data` key that collides with a reserved key is preserved under `custom`.
 */
export interface INotificationPayload {
    /** True when the payload represents the user tapping a notification. */
    wasTapped: boolean;
    title?: string;
    subtitle?: string;
    body?: string;
    badge?: number;
    /** Native message id when the transport provides one. */
    messageId?: string;
    /** User-supplied keys that collided with reserved metadata. */
    custom?: Record<string, unknown>;
    /** Names of keys that were relocated into `custom`. */
    _fcm?: {
        collisions: string[];
        dropped?: string[];
    };
    [key: string]: unknown;
}
export interface IListenOptions {
    /** Dispose the listener after the first delivery. */
    once?: boolean;
}
export type NativeEvent = {
    kind: 'notification';
    payload: INotificationPayload;
} | {
    kind: 'tokenRefresh';
    token: string;
};
export interface IPluginBridge {
    readonly runtime: RuntimeId;
    readonly platformId: PlatformId;
    /** Invoke a native action; rejections carry an FCMError-shaped cause. */
    call<T = unknown>(action: string, args?: readonly unknown[]): Promise<T>;
    /**
     * Attach a native event listener; returns the teardown function.
     * `onTransportError` reports transport-level failures (the event bridge
     * died), which is distinct from a bad payload.
     */
    addEventListener(listener: (event: NativeEvent) => void, onTransportError?: (error: FCMError) => void): () => void;
    /**
     * Optional: resolves once an asynchronous native event registration (Capacitor
     * `addListener` returns a promise) has actually completed. The core awaits this
     * between attaching the listener and asking native for `ready` /
     * `replayBufferedEvents`, otherwise a cold-start burst can be emitted while the
     * registration is still in flight and the events are lost.
     */
    waitForEventRegistration?(): Promise<void>;
}
export interface IFCMOptions {
    /**
     * Start the native handshake and event bridge at construction. Defaults to
     * true, matching 7.x. When false, call `initialize()` explicitly.
     */
    autoInitialize?: boolean;
    /** JS-side replay buffer for events that arrive before a listener exists. */
    eventBufferSize?: number;
    /** Bounded LRU used for receipt/tap dedup (native side has its own copy). */
    dedupCacheSize?: number;
    /**
     * Opt-in topics subscribed once the plugin is ready. 7.x subscribed to
     * "all"/"android"/"ios" automatically; 8.x never does.
     */
    autoSubscribeTopics?: string[];
    /** Opt-in foreground presentation, applied natively during initialization. */
    foregroundPresentation?: IForegroundPresentationOptions;
}
