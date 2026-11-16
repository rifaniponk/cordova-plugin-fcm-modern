package android.util;

/**
 * JVM compile stub for the native behavior harness (tests/android). It exists
 * only so `javac` can compile Android-facing sources on Linux; it is never
 * shipped and never stands in for a Gradle or on-device build.
 */
public final class Log {
    private Log() {}

    public static int d(String tag, String msg) {
        System.out.println("[stub Log.d] " + tag + ": " + msg);
        return 0;
    }

    public static int e(String tag, String msg) {
        System.out.println("[stub Log.e] " + tag + ": " + msg);
        return 0;
    }
}
