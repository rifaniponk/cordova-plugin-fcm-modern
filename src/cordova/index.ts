import { FCMCore } from '../core/fcmCore.js'
import type { IFCMOptions } from '../core/types.js'
import { CordovaBridge, getCordovaHost } from '../bridges/cordovaBridge.js'

export { CordovaBridge, getCordovaHost } from '../bridges/cordovaBridge.js'
export { FCMCore } from '../core/fcmCore.js'
export * from '../core/index.js'

/**
 * Explicit Cordova entry: `import { FCM } from 'cordova-plugin-fcm-modern/cordova'`.
 * Cordova's own `<clobbers target="FCM" />` binding is produced from this module,
 * so `window.FCM` and the imported instance are the same object.
 */
export const createFCM = (options: IFCMOptions = {}): FCMCore =>
    new FCMCore(CordovaBridge.create(), options)

export const FCM = createFCM()

// Only assign a global when one exists: importing in Node/SSR must stay safe.
const host = globalThis as unknown as { window?: Record<string, unknown> }
if (typeof host.window === 'object' && host.window !== null && getCordovaHost() !== null) {
    host.window.FCM = FCM
}

export default FCM
