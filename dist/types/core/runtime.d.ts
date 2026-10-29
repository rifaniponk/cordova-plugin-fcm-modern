import type { PlatformId, RuntimeId } from './types.js';
export interface RuntimeHost {
    cordova?: {
        platformId?: string;
        exec?: unknown;
    };
    Capacitor?: {
        isNativePlatform?: () => boolean;
        getPlatform?: () => string;
        Plugins?: Record<string, unknown>;
    };
}
/** Reads host globals without ever touching an undefined `window`. */
export declare const readHost: () => RuntimeHost | undefined;
export declare const isCapacitorHost: (host: RuntimeHost | undefined) => boolean;
export declare const isCordovaHost: (host: RuntimeHost | undefined) => boolean;
/**
 * Chooses the bridge for the ambient runtime. Capacitor wins when a Capacitor
 * app is present, Cordova when it is not; neither requires the other runtime.
 */
export declare const detectRuntime: () => {
    runtime: RuntimeId;
    platformId: PlatformId;
};
