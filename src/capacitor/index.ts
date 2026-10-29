import { FCMCore } from '../core/fcmCore.js'
import { RuntimeBridge } from '../core/runtimeBridge.js'
import type { IFCMOptions, IPluginBridge } from '../core/types.js'
import { CapacitorBridge } from '../bridges/capacitorBridge.js'
import { WebBridge } from '../bridges/webBridge.js'
import type { FCMListenerHandle, FCMNativeContract } from './contract.js'

export type { FCMNativeContract, FCMListenerHandle } from './contract.js'
export { CapacitorBridge } from '../bridges/capacitorBridge.js'

/**
 * Capacitor's `registerPlugin` surface. Declared structurally so this module
 * type-checks without the optional Capacitor peer installed, and so the tests can
 * register a fake native plugin.
 */
type RegisterPlugin = <T>(pluginId: string, implementations?: { web?: () => Promise<T> | T }) => T

type LoadRegisterPlugin = () => Promise<{ registerPlugin: RegisterPlugin }>

/** Web stand-in required by Capacitor's plugin registry: fails, never hangs. */
class WebFCMPlugin implements Partial<FCMNativeContract> {
    private unsupported(method: string): Promise<never> {
        return Promise.reject(
            new Error(
                `FCMPlugin.${method} is not available on web: cordova-plugin-fcm-modern implements Android and iOS push only.`
            )
        )
    }

    ready(): Promise<void> {
        return this.unsupported('ready')
    }
    replayBufferedEvents(): Promise<void> {
        return this.unsupported('replayBufferedEvents')
    }
    setForegroundPresentation(): Promise<void> {
        return this.unsupported('setForegroundPresentation')
    }
    getToken(): Promise<{ value: string }> {
        return this.unsupported('getToken')
    }
    deleteToken(): Promise<void> {
        return this.unsupported('deleteToken')
    }
    getAPNSToken(): Promise<{ value: string }> {
        return this.unsupported('getAPNSToken')
    }
    getInitialPushPayload(): Promise<{ payload: Record<string, unknown> | null }> {
        return this.unsupported('getInitialPushPayload')
    }
    hasPermission(): Promise<{ value: boolean }> {
        return this.unsupported('hasPermission')
    }
    requestPushPermission(): Promise<{ value: boolean }> {
        return this.unsupported('requestPushPermission')
    }
    subscribeToTopic(): Promise<void> {
        return this.unsupported('subscribeToTopic')
    }
    unsubscribeFromTopic(): Promise<void> {
        return this.unsupported('unsubscribeFromTopic')
    }
    clearAllNotifications(): Promise<void> {
        return this.unsupported('clearAllNotifications')
    }
    createNotificationChannel(): Promise<void> {
        return this.unsupported('createNotificationChannel')
    }
    addListener(): Promise<FCMListenerHandle> {
        return Promise.resolve({ remove: () => Promise.resolve() })
    }
}

let registered: FCMNativeContract | null = null

/** The registered native plugin, or the web stand-in when running in a browser. */
export const getNativePlugin = async (
    loader: LoadRegisterPlugin = () =>
        import('@capacitor/core').then((core) => ({
            registerPlugin: core.registerPlugin as RegisterPlugin
        }))
): Promise<FCMNativeContract> => {
    if (registered !== null) {
        return registered
    }
    const { registerPlugin } = await loader()
    registered = registerPlugin<FCMNativeContract>('FCMPlugin', {
        web: () => new WebFCMPlugin()
    })
    return registered
}

export const createCapacitorBridge = async (): Promise<IPluginBridge> => {
    const plugin = await getNativePlugin()
    const platform = (
        globalThis as { Capacitor?: { getPlatform?: () => string } }
    ).Capacitor?.getPlatform?.()
    const platformId = platform === 'android' || platform === 'ios' ? platform : 'unknown'
    if (platformId === 'unknown' && platform === 'web') {
        return new WebBridge()
    }
    return new CapacitorBridge(plugin, platformId)
}

const capacitorPlatformId = (): 'android' | 'ios' | 'web' | 'unknown' => {
    const platform = (
        globalThis as { Capacitor?: { getPlatform?: () => string } }
    ).Capacitor?.getPlatform?.()
    return platform === 'android' || platform === 'ios' || platform === 'web' ? platform : 'unknown'
}

/**
 * Capacitor-first entry: `import { FCM } from 'cordova-plugin-fcm-modern/capacitor'`.
 * The native plugin is registered lazily, so importing this module in a browser
 * or during SSR is safe.
 */
export const createFCM = (options: IFCMOptions = {}): FCMCore => {
    const platformId = capacitorPlatformId()
    const bridge = new RuntimeBridge(
        async () => (platformId === 'web' ? new WebBridge() : createCapacitorBridge()),
        { runtime: 'capacitor', platformId }
    )
    return new FCMCore(bridge, options)
}

export { FCMCore }
export type { IFCMOptions }

/**
 * Instance created on first import. Auto-initialisation is on by default, so an
 * app that imports this subpath in `index.html`/`main.tsx` receives cold-start
 * events as soon as the native replay runs.
 */
export const FCM = createFCM()
