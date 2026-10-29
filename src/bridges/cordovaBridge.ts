import { FCMError, toFCMError } from '../core/errors.js'
import { readHost } from '../core/runtime.js'
import type { IPluginBridge, NativeEvent, PlatformId } from '../core/types.js'

export interface CordovaExecHost {
    platformId?: string
    exec: (
        success: (...args: unknown[]) => void,
        fail: (...args: unknown[]) => void,
        service: string,
        action: string,
        args: unknown[]
    ) => void
}

export const BRIDGE_SERVICE = 'FCMPlugin'

/** Reads `window.cordova` lazily so importing this module never needs a DOM. */
export const getCordovaHost = (): CordovaExecHost | null => {
    const host = readHost()
    const cordova = host?.cordova
    if (cordova && typeof cordova.exec === 'function') {
        return cordova as CordovaExecHost
    }
    return null
}

const normalisePlatform = (value: string | undefined): PlatformId =>
    value === 'android' || value === 'ios' ? value : 'unknown'

const toEvent = (raw: unknown): NativeEvent | null => {
    if (!Array.isArray(raw) || raw.length < 2) {
        return null
    }
    const [name, data] = raw
    if (name === 'notification' && typeof data === 'object' && data !== null) {
        return {
            kind: 'notification',
            payload: data as NativeEvent extends never ? never : Record<string, unknown>
        } as NativeEvent
    }
    if (name === 'tokenRefresh' && typeof data === 'string') {
        return { kind: 'tokenRefresh', token: data }
    }
    return null
}

/**
 * Cordova transport: `cordova.exec` promises + one long-lived keep-alive callback
 * for native-originated events.
 */
export class CordovaBridge implements IPluginBridge {
    public readonly runtime = 'cordova' as const
    public readonly platformId: PlatformId

    private attached = false
    private readonly cordova: CordovaExecHost | null

    constructor(cordova: CordovaExecHost | null, platformId?: PlatformId) {
        this.cordova = cordova
        this.platformId = platformId ?? normalisePlatform(cordova?.platformId)
    }

    public static create(platformId?: PlatformId): CordovaBridge {
        return new CordovaBridge(getCordovaHost(), platformId)
    }

    public call<T = unknown>(action: string, args: readonly unknown[] = []): Promise<T> {
        const cordova = this.cordova
        if (cordova === null) {
            return Promise.reject(
                new FCMError(
                    'bridge_unavailable',
                    'Cordova bridge is not present in this environment (window.cordova.exec)',
                    { platform: this.platformId }
                )
            )
        }
        return new Promise<T>((resolve, reject) => {
            try {
                cordova.exec(
                    (value: unknown) => resolve(value as T),
                    (error: unknown) =>
                        reject(
                            toFCMError(
                                'native_error',
                                error,
                                `Cordova "${action}" failed`,
                                this.platformId
                            )
                        ),
                    BRIDGE_SERVICE,
                    action,
                    [...args]
                )
            } catch (error) {
                reject(
                    toFCMError(
                        'bridge_unavailable',
                        error,
                        `Cordova "${action}" threw`,
                        this.platformId
                    )
                )
            }
        })
    }

    /**
     * Installs the native event bridge. The callback is keep-alive: every native
     * payload arrives as a JSON string `[eventName, data]`.
     */
    public addEventListener(
        listener: (event: NativeEvent) => void,
        onTransportError?: (error: FCMError) => void
    ): () => void {
        if (this.attached || this.cordova === null) {
            return () => undefined
        }
        this.attached = true
        let active = true
        const onRaw = (data: unknown): void => {
            if (!active) {
                return
            }
            if (typeof data !== 'string') {
                return
            }
            let parsed: unknown
            try {
                parsed = JSON.parse(data)
            } catch (error) {
                onTransportError?.(
                    new FCMError('native_error', 'Malformed native event payload', {
                        platform: this.platformId,
                        cause: error
                    })
                )
                return
            }
            const event = toEvent(parsed)
            if (event !== null) {
                listener(event)
            }
        }
        const onFail = (error: unknown): void => {
            active = false
            this.attached = false
            onTransportError?.(
                toFCMError(
                    'bridge_unavailable',
                    error,
                    'Native event bridge failed',
                    this.platformId
                )
            )
        }
        try {
            this.cordova.exec(onRaw, onFail, BRIDGE_SERVICE, 'startJsEventBridge', [])
        } catch (error) {
            this.attached = false
            active = false
            onTransportError?.(
                toFCMError(
                    'bridge_unavailable',
                    error,
                    'Native event bridge could not start',
                    this.platformId
                )
            )
        }
        return () => {
            if (!active) {
                return
            }
            active = false
            this.attached = false
            // Best effort: the native sink is dropped, buffered events stay queued.
            try {
                this.cordova?.exec(
                    () => undefined,
                    () => undefined,
                    BRIDGE_SERVICE,
                    'stopJsEventBridge',
                    []
                )
            } catch {
                // ignore: teardown of an already-dead bridge is not an error path
            }
        }
    }
}
