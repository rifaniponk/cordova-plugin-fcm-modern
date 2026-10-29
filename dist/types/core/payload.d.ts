import type { INotificationPayload } from './types.js';
/**
 * Trusted native metadata. Message `data` can never overwrite these: a colliding
 * user key is relocated to `custom` and named in `_fcm.collisions`.
 */
export declare const RESERVED_KEYS: readonly ["wasTapped", "title", "subtitle", "body", "badge", "messageId", "custom", "_fcm"];
/**
 * Keys that must never be copied onto a plain object: assigning `__proto__`
 * through a normal write mutates the prototype chain instead of adding a key.
 */
export declare const UNSAFE_KEYS: readonly string[];
/**
 * Native wire envelope. The native core separates transport metadata from the
 * sender's `data` map so the JS side can flatten it without letting a remote
 * payload spoof trusted fields.
 */
export interface IRawNativeEnvelope {
    wasTapped?: boolean;
    messageId?: string | number;
    title?: string;
    subtitle?: string;
    body?: string;
    badge?: number;
    data?: Record<string, unknown>;
    [key: string]: unknown;
}
/**
 * Canonical message id used for dedup. `messageId` is authoritative; the aliases
 * mirror what Firebase hands each platform (Android `messageId` from the SDK,
 * iOS `gcm.message_id`/`_id` inside userInfo, older Android `id_`/`_u`/`_c`
 * collapse fields are deliberately *not* treated as ids).
 */
export declare const extractMessageId: (raw: IRawNativeEnvelope) => string | undefined;
/**
 * Flattens a native envelope into the public payload shape.
 *
 * Rules (docs/ARCHITECTURE.md §4):
 *  - trusted metadata wins over user keys;
 *  - colliding user keys are preserved under `custom.<key>`;
 *  - prototype-sensitive keys are dropped and recorded in `_fcm.dropped`;
 *  - an id-less message gets no dedup key, so unrelated messages never collapse.
 */
export declare const sanitizeNotificationPayload: (raw: unknown) => INotificationPayload | null;
