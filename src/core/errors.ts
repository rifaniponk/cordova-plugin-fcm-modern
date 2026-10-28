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

/** Normalises whatever a native bridge rejected into an FCMError. */
export const toFCMError = (
    code: FCMErrorCode,
    raw: unknown,
    fallbackMessage: string,
    platform?: string
): FCMError => {
    if (isFCMError(raw)) {
        return raw
    }
    if (raw instanceof Error) {
        return new FCMError(code, raw.message || fallbackMessage, { platform, cause: raw })
    }
    if (typeof raw === 'string' && raw.length > 0) {
        return new FCMError(code, raw, { platform, cause: raw })
    }
    if (typeof raw === 'object' && raw !== null) {
        const record = raw as { message?: unknown; cause?: unknown }
        const message =
            typeof record.message === 'string' && record.message.length > 0
                ? record.message
                : fallbackMessage
        return new FCMError(code, message, { platform, cause: record.cause ?? raw })
    }
    return new FCMError(code, fallbackMessage, { platform, cause: raw })
}
