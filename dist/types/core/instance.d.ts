import type { FCMCore } from './fcmCore.js';
/** Returns the app-wide instance, creating it with `create` on first use. */
export declare const sharedFCM: (create: () => FCMCore) => FCMCore;
/** The key itself, exported so tests can assert the registries agree on it. */
export declare const sharedFCMKey: symbol;
/** Test-only: drops the shared instance so entrypoint tests stay independent. */
export declare const resetSharedFCM: () => void;
