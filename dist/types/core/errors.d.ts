export declare const FCM_ERROR_CODES: readonly ["unsupported_platform", "bridge_unavailable", "invalid_argument", "native_error", "timeout", "not_initialized"];
export type FCMErrorCode = (typeof FCM_ERROR_CODES)[number];
/** Error thrown/rejected by every public API of this plugin. */
export declare class FCMError extends Error {
    readonly code: FCMErrorCode;
    readonly platform: string | undefined;
    readonly cause: unknown;
    constructor(code: FCMErrorCode, message: string, options?: {
        platform?: string;
        cause?: unknown;
    });
}
export declare const isFCMError: (value: unknown) => value is FCMError;
/** Normalises whatever a native bridge rejected into an FCMError. */
export declare const toFCMError: (code: FCMErrorCode, raw: unknown, fallbackMessage: string, platform?: string) => FCMError;
