import { CordovaBridge } from '../bridges/cordovaBridge.js'
import { WebBridge } from '../bridges/webBridge.js'
import type { IPluginBridge, RuntimeId } from './types.js'

/**
 * Runtime → bridge routing, in its own module.
 *
 * It cannot live in the package root: the Ionic wrappers need this router, and a
 * wrapper importing the root entry would close an ESM cycle (root → ionic →
 * root). Under a cycle the root's `export const FCM = sharedFCM(...)` runs after
 * the wrapper body, so the wrapper would read a binding still in its temporal
 * dead zone. A leaf module keeps the graph acyclic for every entrypoint.
 *
 * Capacitor's module stays behind a dynamic import so a Cordova-only app never
 * needs the optional `@capacitor/core` peer, and vice versa.
 */
export const loadBridge = async (runtime: RuntimeId): Promise<IPluginBridge> => {
    if (runtime === 'cordova') {
        return CordovaBridge.create()
    }
    if (runtime === 'capacitor') {
        const capacitor = await import('../capacitor/index.js')
        return capacitor.createCapacitorBridge()
    }
    return new WebBridge()
}
