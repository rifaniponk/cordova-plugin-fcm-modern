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
const isSupportedCode = (value) => typeof value === 'string' && FCM_ERROR_CODES.includes(value);
/**
 * Reads a diagnostic code off whatever the native side rejected with: a
 * Capacitor `Error` with a `code` field, a Cordova failure dictionary, or a
 * cross-realm FCMError-shaped object. Codes outside `FCM_ERROR_CODES` (for
 * instance Capacitor's `UNIMPLEMENTED`) carry no meaning for this API and are
 * discarded so the caller's own diagnosis wins.
 */
const nativeCode = (raw) => {
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const code = raw.code;
    return isSupportedCode(code) ? code : undefined;
};
/** Normalises whatever a native bridge rejected into an FCMError. */
export const toFCMError = (code, raw, fallbackMessage, platform) => {
    // Only a *real* FCMError keeps its identity; an object that merely looks like
    // one (a second bundled copy of this class, a cross-realm rejection) is
    // rebuilt here so callers always catch an actual Error, while its supported
    // code — "timeout" stays "timeout" — survives the rebuild.
    if (raw instanceof FCMError) {
        return raw;
    }
    const resolvedCode = nativeCode(raw) ?? code;
    if (raw instanceof Error) {
        return new FCMError(resolvedCode, raw.message || fallbackMessage, {
            platform,
            cause: raw
        });
    }
    if (typeof raw === 'string' && raw.length > 0) {
        return new FCMError(resolvedCode, raw, { platform, cause: raw });
    }
    if (typeof raw === 'object' && raw !== null) {
        const record = raw;
        const message = typeof record.message === 'string' && record.message.length > 0
            ? record.message
            : fallbackMessage;
        return new FCMError(resolvedCode, message, { platform, cause: record.cause ?? raw });
    }
    return new FCMError(resolvedCode, fallbackMessage, { platform, cause: raw });
};
