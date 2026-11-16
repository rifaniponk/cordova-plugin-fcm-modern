package dev.rifan.fcmmodern.core;

import android.util.Log;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * Runtime-free native event bus. Events are queued before any JS bridge exists
 * (cold start / late attach), replayed in chronological order on attach, and
 * deduplicated per identity space: a receipt and a later tap of the same
 * message id are distinct events. Queues and dedup sets are bounded; overflow
 * drops the oldest event and logs without logging payloads.
 */
public final class FcmEventBus {
    public enum Space {
        RECEIPT,
        TAP
    }

    private static final String TAG = "FCMModern";
    private static final int MAX_QUEUE = 50;
    private static final int MAX_DEDUP = 100;

    private final LinkedHashMap<String, Boolean> receiptSeen = lru();
    private final LinkedHashMap<String, Boolean> tapSeen = lru();
    /** One queue across spaces so replay is chronological, not space-sorted. */
    private final ArrayList<JSONObject> notificationQueue = new ArrayList<>();
    private final ArrayList<Consumer<JSONObject>> notificationSinks = new ArrayList<>();
    private final ArrayList<Consumer<String>> tokenSinks = new ArrayList<>();
    private final AtomicLong fallbackId = new AtomicLong(0);
    private String lastToken = null;
    private JSONObject startupTap = null;

    private static LinkedHashMap<String, Boolean> lru() {
        return new LinkedHashMap<String, Boolean>(16, 0.75f, false) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                return size() > MAX_DEDUP;
            }
        };
    }

    /** Ids without a native message id must never collapse into one event. */
    public String nextFallbackId() {
        return "fcm-native-" + fallbackId.incrementAndGet();
    }

    /** Returns false when the event was a duplicate for this identity space. */
    public synchronized boolean enqueueNotification(Space space, JSONObject payload, String dedupKey) {
        LinkedHashMap<String, Boolean> seen = space == Space.TAP ? tapSeen : receiptSeen;
        if (seen.containsKey(dedupKey)) {
            return false;
        }
        seen.put(dedupKey, Boolean.TRUE);
        notificationQueue.add(payload);
        if (notificationQueue.size() > MAX_QUEUE) {
            notificationQueue.remove(0);
            Log.d(TAG, "FCM native event queue overflow; oldest event dropped");
        }
        if (space == Space.TAP && startupTap == null) {
            startupTap = payload;
        }
        dispatchNotificationLocked(payload);
        return true;
    }

    public synchronized void publishToken(String token) {
        lastToken = token;
        List<Consumer<String>> sinks = new ArrayList<>(tokenSinks);
        for (Consumer<String> sink : sinks) {
            try {
                sink.accept(token);
            } catch (Exception error) {
                Log.d(TAG, "FCM token listener failed: " + error.getClass().getSimpleName());
            }
        }
    }

    public synchronized void attachNotificationSink(Consumer<JSONObject> sink) {
        ArrayList<JSONObject> replay = new ArrayList<>(notificationQueue);
        notificationSinks.add(sink);
        for (JSONObject payload : replay) {
            try {
                sink.accept(payload);
            } catch (Exception error) {
                Log.d(TAG, "FCM notification sink failed: " + error.getClass().getSimpleName());
            }
        }
    }

    public synchronized void detachNotificationSink(Consumer<JSONObject> sink) {
        notificationSinks.remove(sink);
    }

    /** A token listener attached late receives the newest token exactly once. */
    public synchronized void attachTokenSink(Consumer<String> sink) {
        tokenSinks.add(sink);
        if (lastToken != null) {
            try {
                sink.accept(lastToken);
            } catch (Exception error) {
                Log.d(TAG, "FCM token sink failed: " + error.getClass().getSimpleName());
            }
        }
    }

    public synchronized void detachTokenSink(Consumer<String> sink) {
        tokenSinks.remove(sink);
    }

    public synchronized void setStartupTap(JSONObject payload) {
        if (startupTap == null) {
            startupTap = payload;
        }
    }

    public synchronized JSONObject getStartupTap() {
        return startupTap;
    }

    private void dispatchNotificationLocked(JSONObject payload) {
        List<Consumer<JSONObject>> sinks = new ArrayList<>(notificationSinks);
        for (Consumer<JSONObject> sink : sinks) {
            try {
                sink.accept(payload);
            } catch (Exception error) {
                Log.d(TAG, "FCM notification sink failed: " + error.getClass().getSimpleName());
            }
        }
    }
}
