import type { IChannelConfiguration, IForegroundPresentationOptions, IRequestPushPermissionOptions } from '../core/types.js';
/**
 * Wire contract implemented by the Capacitor native plugins (Android + iOS).
 * Every value-returning operation is wrapped in `{ value }` / `{ payload }`
 * so both platforms can use the same ReadableMap / dictionary shape.
 * Arguments are objects, never bare strings: Capacitor marshals every method
 * through one JS options object, so a bare string has no parameter to bind to.
 *
 * Event names emitted by the native side:
 *   - `notification`  → the native envelope (see src/core/payload.ts)
 *   - `tokenRefresh`  → `{ token: string }`
 */
export interface FCMNativeContract {
    ready(): Promise<void>;
    replayBufferedEvents(): Promise<void>;
    setForegroundPresentation(options: IForegroundPresentationOptions): Promise<void>;
    getToken(): Promise<{
        value: string;
    }>;
    deleteToken(): Promise<void>;
    getAPNSToken(): Promise<{
        value: string;
    }>;
    getInitialPushPayload(): Promise<{
        payload: Record<string, unknown> | null;
    }>;
    hasPermission(): Promise<{
        value: boolean;
    }>;
    requestPushPermission(options: IRequestPushPermissionOptions): Promise<{
        value: boolean;
    }>;
    subscribeToTopic(options: {
        topic: string;
    }): Promise<void>;
    unsubscribeFromTopic(options: {
        topic: string;
    }): Promise<void>;
    clearAllNotifications(): Promise<void>;
    createNotificationChannel(channel: IChannelConfiguration): Promise<void>;
    setAutoInitEnabled(options: {
        enabled: boolean;
    }): Promise<void>;
    isAutoInitEnabled(): Promise<{
        value: boolean;
    }>;
    addListener(eventName: 'notification', listenerFunc: (envelope: Record<string, unknown>) => void): Promise<FCMListenerHandle>;
    addListener(eventName: 'tokenRefresh', listenerFunc: (event: {
        token: string;
    }) => void): Promise<FCMListenerHandle>;
}
export interface FCMListenerHandle {
    remove(): Promise<void>;
}
