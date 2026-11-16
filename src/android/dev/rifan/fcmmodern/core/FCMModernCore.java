package dev.rifan.fcmmodern.core;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.json.JSONObject;

/**
 * Runtime-agnostic Android core shared by the Cordova and Capacitor adapters.
 * SDK calls go through NativeGateway so each runtime can wire its own
 * discovery/loader without duplicating core logic. Topic operations resolve
 * only after the token operation finishes (with a useful error if the token
 * operation failed), and permission prompts are explicit.
 */
public final class FCMModernCore {
    public interface TokenCallback {
        void onResult(String token);

        void onError(String message);
    }

    public interface OperationCallback {
        void onSuccess();

        void onError(String message);
    }

    public interface PermissionCallback {
        void onGranted();

        void onDenied(String message);
    }

    /** SDK-backed transport owned by each runtime adapter. */
    public interface NativeGateway {
        void requestToken(TokenCallback callback);

        void deleteToken(TokenCallback callback);

        void subscribeTopic(String topic, OperationCallback callback);

        void unsubscribeTopic(String topic, OperationCallback callback);

        void createChannel(String channelId, String channelName);

        void cancelNotifications();

        void requestPermission(PermissionCallback callback);
    }

    public static final String CHANNEL_ID = "fcmmodern_default";
    public static final String CHANNEL_NAME = "FCMModern Push Notifications";

    private final FcmEventBus bus;
    private final NativeGateway gateway;
    private String cachedToken = null;
    private boolean tokenInFlight = false;
    private final List<TokenCallback> tokenWaiters = new ArrayList<>();
    private final List<Runnable> pendingTopicOps = new ArrayList<>();

    public FCMModernCore(FcmEventBus bus, NativeGateway gateway) {
        this.bus = bus;
        this.gateway = gateway;
    }

    public void getToken(TokenCallback callback) {
        if (cachedToken != null) {
            callback.onResult(cachedToken);
            return;
        }
        tokenWaiters.add(callback);
        if (!tokenInFlight) {
            tokenInFlight = true;
            gateway.requestToken(new TokenCallback() {
                @Override
                public void onResult(String token) {
                    cachedToken = token;
                    tokenInFlight = false;
                    List<TokenCallback> waiters = drain(tokenWaiters);
                    for (TokenCallback waiter : waiters) {
                        waiter.onResult(token);
                    }
                    List<Runnable> ops = drain(pendingTopicOps);
                    for (Runnable op : ops) {
                        op.run();
                    }
                }

                @Override
                public void onError(String message) {
                    tokenInFlight = false;
                    List<TokenCallback> waiters = drain(tokenWaiters);
                    for (TokenCallback waiter : waiters) {
                        waiter.onError("FCM token unavailable: " + message);
                    }
                    // Topics resolve after the SDK token operation finishes;
                    // a failed token surfaces as a topic error, never a hang.
                    List<Runnable> ops = drain(pendingTopicOps);
                    for (Runnable op : ops) {
                        op.run();
                    }
                }
            });
        }
    }

    /** Compatibility alias for deleting the current token, not the install. */
    public void deleteToken(final TokenCallback callback) {
        gateway.deleteToken(new TokenCallback() {
            @Override
            public void onResult(String token) {
                cachedToken = null;
                callback.onResult(token);
            }

            @Override
            public void onError(String message) {
                callback.onError("FCM token deletion failed: " + message);
            }
        });
    }

    public void subscribeTopic(final String topic, final OperationCallback callback) {
        afterToken(() -> gateway.subscribeTopic(topic, wrap(topic, "subscribe", callback)));
    }

    public void unsubscribeTopic(final String topic, final OperationCallback callback) {
        afterToken(() -> gateway.unsubscribeTopic(topic, wrap(topic, "unsubscribe", callback)));
    }

    private OperationCallback wrap(String topic, String op, OperationCallback callback) {
        return new OperationCallback() {
            @Override
            public void onSuccess() {
                callback.onSuccess();
            }

            @Override
            public void onError(String message) {
                callback.onError("FCM topic " + op + " failed for \"" + topic + "\": " + message);
            }
        };
    }

    /** Topics resolve only after the SDK token operation finishes. */
    private void afterToken(Runnable operation) {
        if (cachedToken != null) {
            operation.run();
            return;
        }
        pendingTopicOps.add(operation);
        getToken(new TokenCallback() {
            @Override
            public void onResult(String token) {
                /* draining happens in the shared token fan-out */
            }

            @Override
            public void onError(String message) {
                /* topics still resolve with a useful error */
            }
        });
    }

    private static <T> List<T> drain(List<T> list) {
        List<T> copy = new ArrayList<>(list);
        list.clear();
        return copy;
    }

    public void createNotificationChannel() {
        gateway.createChannel(CHANNEL_ID, CHANNEL_NAME);
    }

    public void cancelAllNotifications() {
        gateway.cancelNotifications();
    }

    public void requestPermission(final PermissionCallback callback) {
        gateway.requestPermission(new PermissionCallback() {
            @Override
            public void onGranted() {
                callback.onGranted();
            }

            @Override
            public void onDenied(String message) {
                callback.onDenied("Notification permission denied: " + message);
            }
        });
    }

    /** Normalizes one delivery and enqueues the event on the shared bus. */
    public JSONObject onNativeEvent(Map<String, String> data, String messageId, boolean wasTapped,
                                    String title, String subtitle, String body, Integer badge) {
        return enqueue(bus, data, messageId, wasTapped, title, subtitle, body, badge);
    }

    /** Usable before any adapter exists, so cold-start events still queue. */
    public static JSONObject enqueue(FcmEventBus targetBus, Map<String, String> data, String messageId,
                                     boolean wasTapped, String title, String subtitle, String body, Integer badge) {
        JSONObject payload = FCMPayload.normalize(data, messageId, wasTapped, title, subtitle, body, badge);
        String dedupKey = FCMPayload.dedupKey(messageId, targetBus.nextFallbackId());
        targetBus.enqueueNotification(wasTapped ? FcmEventBus.Space.TAP : FcmEventBus.Space.RECEIPT,
            payload, dedupKey);
        return payload;
    }

    public JSONObject getStartupTap() {
        return bus.getStartupTap();
    }
}
