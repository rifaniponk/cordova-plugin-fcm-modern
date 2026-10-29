import { FCMError } from '../core/errors.js'
import type { IPluginBridge, NativeEvent } from '../core/types.js'

/**
 * There is deliberately **no** browser push implementation: web imports must not
 * crash, and every native operation must fail with an explicit, actionable error
 * instead of pretending to work or silently hanging.
 */
export class WebBridge implements IPluginBridge {
    public readonly runtime = 'web' as const
    public readonly platformId = 'web' as const

    public call<T = unknown>(action: string): Promise<T> {
        return Promise.reject(
            new FCMError(
                'unsupported_platform',
                `FCM action "${action}" is unavailable on the web platform: this plugin implements Android and iOS push only. Serve web push from your own service worker instead.`,
                { platform: this.platformId }
            )
        )
    }

    public addEventListener(): () => void {
        return () => undefined
    }
}
