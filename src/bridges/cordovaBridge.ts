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

/**
 * Cordova's keep-alive callback delivers one JSON string per event, shaped
 * `[eventName, value]`. A structurally broken envelope is a transport defect and
 * gets reported; an unknown event name is not, because a newer native core may
 * add events and failing the bridge over one would drop everything else.
 */
export const parseNativeEnvelope = (raw: unknown): NativeEvent | null | 'malformed' => {
    if (!Array.isArray(raw) || raw.length < 2) {
        return 'malformed'
    }
    const [name, value] = raw
    if (name === 'notification') {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return 'malformed'
        }
        return { kind: 'notification', payload: value as Record<string, unknown> } as NativeEvent
    }
    if (name === 'tokenRefresh') {
        if (typeof value !== 'string') {
            return 'malformed'
        }
        return { kind: 'tokenRefresh', token: value }
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
        const report = (
            code: 'native_error' | 'bridge_unavailable',
            message: string,
            cause?: unknown
        ): void => {
            onTransportError?.(new FCMError(code, message, { platform: this.platformId, cause }))
        }
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
                report('native_error', 'Malformed native event payload', error)
                return
            }
            const event = parseNativeEnvelope(parsed)
            if (event === 'malformed') {
                report('native_error', 'Native event does not match [eventName, value]')
                return
            }
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
