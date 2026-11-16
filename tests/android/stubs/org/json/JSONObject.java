package org.json;

/**
 * JVM compile stub for the native behavior harness (tests/android). The event
 * bus treats payloads as opaque identities, so an empty class is enough to
 * compile and assert event identity; it is never shipped.
 */
public class JSONObject {
    private final String label;

    public JSONObject(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}
