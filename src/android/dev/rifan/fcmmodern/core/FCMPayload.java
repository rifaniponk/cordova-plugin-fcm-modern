package dev.rifan.fcmmodern.core;

import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import org.json.JSONObject;

/**
 * Mirrors src/core/payload.ts exactly so Android and JS agree on one contract:
 * trusted native metadata wins over sender data; colliding user keys move to
 * custom.<key> and are named in _fcm.collisions; prototype-sensitive keys are
 * dropped and named in _fcm.dropped; an id-less message gets no dedup key.
 */
public final class FCMPayload {
    public static final Set<String> RESERVED_KEYS =
        new LinkedHashSet<>(java.util.Arrays.asList(
            "wasTapped", "title", "subtitle", "body", "badge", "messageId", "custom", "_fcm"));
    private static final Set<String> UNSAFE_KEYS =
        new LinkedHashSet<>(java.util.Arrays.asList("__proto__", "constructor", "prototype"));
    private FCMPayload() {}

    /**
     * Normalizes one delivery into the public payload shape. The canonical
     * message id and presentation fields are trusted SDK values supplied by
     * the caller; `data` carries only sender keys. Id aliases in `data` are
     * reserved collisions, never trusted metadata.
     */
    public static JSONObject normalize(Map<String, String> data, String messageId, boolean wasTapped,
                                       String title, String subtitle, String body, Integer badge) {
        JSONObject payload = new JSONObject();
        payload.put("wasTapped", Boolean.valueOf(wasTapped));
        if (messageId != null && !messageId.isEmpty()) {
            payload.put("messageId", messageId);
        }
        if (title != null) {
            payload.put("title", title);
        }
        if (subtitle != null) {
            payload.put("subtitle", subtitle);
        }
        if (body != null) {
            payload.put("body", body);
        }
        if (badge != null) {
            payload.put("badge", badge);
        }

        java.util.List<String> collisions = new java.util.ArrayList<>();
        java.util.List<String> dropped = new java.util.ArrayList<>();
        JSONObject custom = null;
        for (Map.Entry<String, String> entry : data.entrySet()) {
            String key = entry.getKey();
            if (UNSAFE_KEYS.contains(key)) {
                dropped.add(key);
                continue;
            }
            if (RESERVED_KEYS.contains(key)) {
                collisions.add(key);
                if (custom == null) {
                    custom = new JSONObject();
                    payload.put("custom", custom);
                }
                custom.put(key, entry.getValue());
                continue;
            }
            payload.put(key, entry.getValue());
        }

        if (!collisions.isEmpty() || !dropped.isEmpty()) {
            JSONObject meta = new JSONObject();
            if (!collisions.isEmpty()) {
                meta.put("collisions", collisions);
            }
            if (!dropped.isEmpty()) {
                meta.put("dropped", dropped);
            }
            payload.put("_fcm", meta);
        }
        return payload;
    }

    /** Dedup identity: canonical id when present, otherwise no key at all. */
    public static String dedupKey(String messageId, String fallbackId) {
        return messageId != null && !messageId.isEmpty() ? messageId : fallbackId;
    }
}
