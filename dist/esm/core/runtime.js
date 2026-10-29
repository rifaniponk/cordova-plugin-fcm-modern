/** Reads host globals without ever touching an undefined `window`. */
export const readHost = () => {
    const global = globalThis;
    if (typeof global.window === 'object' && global.window !== null) {
        return global.window;
    }
    // Capacitor/Cordova can also attach to globalThis (node tests, SSR, wkwebview shims).
    if (global.Capacitor || global.cordova) {
        return { Capacitor: global.Capacitor, cordova: global.cordova };
    }
    return undefined;
};
const normalisePlatform = (value) => value === 'android' || value === 'ios'
    ? value
    : value === 'browser' || value === 'web'
        ? 'web'
        : 'unknown';
export const isCapacitorHost = (host) => {
    if (host?.Capacitor === undefined) {
        return false;
    }
    const capacitor = host.Capacitor;
    if (typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform()) {
        return true;
    }
    // A registered native plugin implementation is the strongest signal.
    return typeof capacitor.Plugins?.FCMPlugin === 'object';
};
export const isCordovaHost = (host) => host?.cordova !== undefined && typeof host.cordova.exec === 'function';
/**
 * Chooses the bridge for the ambient runtime. Capacitor wins when a Capacitor
 * app is present, Cordova when it is not; neither requires the other runtime.
 */
export const detectRuntime = () => {
    const host = readHost();
    if (isCapacitorHost(host)) {
        const platform = host?.Capacitor?.getPlatform?.();
        // Capacitor reports "web" in a browser; the native bridge still targets
        // the platform the plugin was compiled for.
        return { runtime: 'capacitor', platformId: normalisePlatform(platform) };
    }
    if (isCordovaHost(host)) {
        return { runtime: 'cordova', platformId: normalisePlatform(host?.cordova?.platformId) };
    }
    return { runtime: 'web', platformId: 'web' };
};
