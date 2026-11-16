package dev.rifan.fcmmodern.service;

import dev.rifan.fcmmodern.core.FCMModernCore;
import dev.rifan.fcmmodern.core.FcmEventBus;

/**
 * One process-wide bus per OS so the Cordova bridge, the Capacitor plugin and
 * the messaging service attach to the same bus instead of competing. The bus
 * exists before JS: cold-start/tap/token events queue until a runtime sink
 * attaches, and later native events keep reaching installed sinks. Adapters
 * install the SDK-backed gateway once; a destroyed bridge's sink is detached
 * without losing later startup events.
 */
public final class FCMModernHolder {
    private static FcmEventBus bus = null;
    private static FCMModernCore core = null;
    private static boolean presentationEnabled = false;

    private FCMModernHolder() {}

    public static synchronized FcmEventBus bus() {
        if (bus == null) {
            bus = new FcmEventBus();
        }
        return bus;
    }

    /** Adapters call this once; later calls are ignored so one core per OS holds. */
    public static synchronized void install(FCMModernCore.NativeGateway gateway) {
        if (core == null) {
            core = new FCMModernCore(bus(), gateway);
        }
    }

    public static synchronized FCMModernCore core() {
        if (core == null) {
            throw new IllegalStateException("FCMModern core not installed: initialize the plugin first");
        }
        return core;
    }

    /** Foreground presentation is opt-in; receipts are event-only by default. */
    public static synchronized void setPresentationEnabled(boolean enabled) {
        presentationEnabled = enabled;
    }

    public static synchronized boolean isPresentationEnabled() {
        return presentationEnabled;
    }
}
