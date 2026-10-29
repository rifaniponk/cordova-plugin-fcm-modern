import type { FCMCore } from './fcmCore.js'

/**
 * One shared instance per process.
 *
 * A Cordova app can reach the same plugin through three *separate* module
 * registries at once: the single-file Cordova bundle (`window.FCM`), the npm ESM
 * path and the npm CJS path (and an Angular wrapper may use either). A module
 * local singleton would then hand the app several FCMCore objects, each with its
 * own event sink, replay buffer and native bridge: cold-start events would be
 * delivered to whichever sink the native side happened to pick and the others
 * would silently starve.
 *
 * `Symbol.for` is the only key those registries share, so it is the only key
 * that can identify "the plugin instance of this app".
 */
const SHARED_INSTANCE_KEY = Symbol.for('cordova-plugin-fcm-modern.fcm.instance')

/** Returns the app-wide instance, creating it with `create` on first use. */
export const sharedFCM = (create: () => FCMCore): FCMCore => {
    const host = globalThis as unknown as Record<symbol, FCMCore | undefined>
    const existing = host[SHARED_INSTANCE_KEY]
    if (existing !== undefined) {
        return existing
    }
    const created = create()
    host[SHARED_INSTANCE_KEY] = created
    return created
}

/** The key itself, exported so tests can assert the registries agree on it. */
export const sharedFCMKey = SHARED_INSTANCE_KEY

/** Test-only: drops the shared instance so entrypoint tests stay independent. */
export const resetSharedFCM = (): void => {
    const host = globalThis as unknown as Record<symbol, FCMCore | undefined>
    delete host[SHARED_INSTANCE_KEY]
}
