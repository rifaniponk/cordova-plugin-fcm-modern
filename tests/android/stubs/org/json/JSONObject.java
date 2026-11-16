package org.json;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * JVM compile stub for the native behavior harness (tests/android). Backed by
 * a LinkedHashMap with the same put/has/optString surface the plugin core
 * uses; it is never shipped and never stands in for a Gradle build.
 */
public class JSONObject {
    private final Map<String, Object> values = new LinkedHashMap<>();
    private final String label;

    public JSONObject() {
        this.label = null;
    }

    public JSONObject(String label) {
        this.label = label;
    }

    public JSONObject put(String key, Object value) {
        values.put(key, value);
        return this;
    }

    public Object get(String key) {
        return values.get(key);
    }

    public String optString(String key) {
        Object value = values.get(key);
        return value == null ? "" : String.valueOf(value);
    }

    public boolean has(String key) {
        return values.containsKey(key);
    }

    public int length() {
        return values.size();
    }

    public String label() {
        return label;
    }
}
