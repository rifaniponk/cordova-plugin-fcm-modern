export const FCM_ERROR_CODES = [
    'unsupported_platform',
    'bridge_unavailable',
    'invalid_argument',
    'native_error',
    'timeout',
    'not_initialized'
] as const

export type FCMErrorCode = (typeof FCM_ERROR_CODES)[number]

/** Error thrown/rejected by every public API of this plugin. */
export class FCMError extends Error {
    public readonly code: FCMErrorCode
    public readonly platform: string | undefined
    public override readonly cause: unknown

    constructor(
        code: FCMErrorCode,
        message: string,
        options?: { platform?: string; cause?: unknown }
    ) {
        super(message)
        this.name = 'FCMError'
        this.code = code
        this.platform = options?.platform
        this.cause = options?.cause
    }
}

export const isFCMError = (value: unknown): value is FCMError =>
    value instanceof FCMError ||
    (typeof value === 'object' &&
        value !== null &&
        (value as { name?: string }).name === 'FCMError' &&
        typeof (value as { code?: unknown }).code === 'string')

const isSupportedCode = (value: unknown): value is FCMErrorCode =>
    typeof value === 'string' && (FCM_ERROR_CODES as readonly string[]).includes(value)

/**
 * Reads a diagnostic code off whatever the native side rejected with: a
 * Capacitor `Error` with a `code` field, a Cordova failure dictionary, or a
 * cross-realm FCMError-shaped object. Codes outside `FCM_ERROR_CODES` (for
 * instance Capacitor's `UNIMPLEMENTED`) carry no meaning for this API and are
 * discarded so the caller's own diagnosis wins.
 */
const nativeCode = (raw: unknown): FCMErrorCode | undefined => {
    if (typeof raw !== 'object' || raw === null) {
        return undefined
    }
    const code = (raw as { code?: unknown }).code
    return isSupportedCode(code) ? code : undefined
}

/** Normalises whatever a native bridge rejected into an FCMError. */
export const toFCMError = (
    code: FCMErrorCode,
    raw: unknown,
    fallbackMessage: string,
    platform?: string
): FCMError => {
    // Only a *real* FCMError keeps its identity; an object that merely looks like
    // one (a second bundled copy of this class, a cross-realm rejection) is
    // rebuilt here so callers always catch an actual Error, while its supported
    // code — "timeout" stays "timeout" — survives the rebuild.
    if (raw instanceof FCMError) {
        return raw
    }
    const resolvedCode = nativeCode(raw) ?? code
    if (raw instanceof Error) {
        return new FCMError(resolvedCode, raw.message || fallbackMessage, {
            platform,
            cause: raw
        })
    }
    if (typeof raw === 'string' && raw.length > 0) {
        return new FCMError(resolvedCode, raw, { platform, cause: raw })
    }
    if (typeof raw === 'object' && raw !== null) {
        const record = raw as { message?: unknown; cause?: unknown }
        const message =
            typeof record.message === 'string' && record.message.length > 0
                ? record.message
                : fallbackMessage
        return new FCMError(resolvedCode, message, { platform, cause: record.cause ?? raw })
    }
    return new FCMError(resolvedCode, fallbackMessage, { platform, cause: raw })
}
