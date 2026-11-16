package com.example.capacitorapp;

import java.util.ArrayList;
import java.util.List;

import com.getcapacitor.Plugin;

import dev.rifan.fcmmodern.capacitor.FCMModernCapacitorPlugin;

/**
 * Capacitor consumer registration. A real Capacitor app hands the Bridge a
 * list of plugin classes; referencing the adapter here proves the plugin class
 * is real and instantiable, not just present on the compile path.
 */
public final class PluginRegistrySetup {
    private PluginRegistrySetup() {}

    public static List<Class<? extends Plugin>> plugins() {
        List<Class<? extends Plugin>> plugins = new ArrayList<>();
        plugins.add(FCMModernCapacitorPlugin.class);
        return plugins;
    }

    public static Plugin instantiate() {
        return new FCMModernCapacitorPlugin();
    }
}
