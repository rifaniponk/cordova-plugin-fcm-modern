export const FCM_ERROR_CODES = [
    'unsupported_platform',
    'bridge_unavailable',
    'invalid_argument',
    'native_error',
    'timeout',
    'not_initialized'
];
/** Error thrown/rejected by every public API of this plugin. */
export class FCMError extends Error {
    code;
    platform;
    cause;
    constructor(code, message, options) {
        super(message);
        this.name = 'FCMError';
        this.code = code;
        this.platform = options?.platform;
        this.cause = options?.cause;
    }
}
export const isFCMError = (value) => value instanceof FCMError ||
    (typeof value === 'object' &&
        value !== null &&
        value.name === 'FCMError' &&
        typeof value.code === 'string');
/** Normalises whatever a native bridge rejected into an FCMError. */
export const toFCMError = (code, raw, fallbackMessage, platform) => {
    if (isFCMError(raw)) {
        return raw;
    }
    if (raw instanceof Error) {
        return new FCMError(code, raw.message || fallbackMessage, { platform, cause: raw });
    }
    if (typeof raw === 'string' && raw.length > 0) {
        return new FCMError(code, raw, { platform, cause: raw });
    }
    if (typeof raw === 'object' && raw !== null) {
        const record = raw;
        const message = typeof record.message === 'string' && record.message.length > 0
            ? record.message
            : fallbackMessage;
        return new FCMError(code, message, { platform, cause: record.cause ?? raw });
    }
    return new FCMError(code, fallbackMessage, { platform, cause: raw });
};
