import type { INotificationPayload } from './types.js'

/**
 * Trusted native metadata. Message `data` can never overwrite these: a colliding
 * user key is relocated to `custom` and named in `_fcm.collisions`.
 */
export const RESERVED_KEYS = [
    'wasTapped',
    'title',
    'subtitle',
    'body',
    'badge',
    'messageId',
    'custom',
    '_fcm'
] as const

/**
 * Keys that must never be copied onto a plain object: assigning `__proto__`
 * through a normal write mutates the prototype chain instead of adding a key.
 */
export const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'] as const

/**
 * Native wire envelope. The native core separates transport metadata from the
 * sender's `data` map so the JS side can flatten it without letting a remote
 * payload spoof trusted fields.
 */
export interface IRawNativeEnvelope {
    wasTapped?: boolean
    messageId?: string | number
    title?: string
    subtitle?: string
    body?: string
    badge?: number
    data?: Record<string, unknown>
    [key: string]: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const safeKey = (key: string): boolean => !UNSAFE_KEYS.includes(key)

/** Copies one key onto the payload without ever touching the prototype chain. */
const assign = (target: Record<string, unknown>, key: string, value: unknown): void => {
    Object.defineProperty(target, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true
    })
}

const asText = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined

const asCount = (value: unknown): number | undefined => {
    const numeric = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numeric) ? numeric : undefined
}

/**
 * Canonical message id used for dedup. `messageId` is authoritative; the aliases
 * mirror what Firebase hands each platform (Android `messageId` from the SDK,
 * iOS `gcm.message_id`/`_id` inside userInfo, older Android `id_`/`_u`/`_c`
 * collapse fields are deliberately *not* treated as ids).
 */
export const extractMessageId = (raw: IRawNativeEnvelope): string | undefined => {
    for (const key of ['messageId', 'gcm.message_id', '_id', '_fcm_message_id']) {
        const value = asText(raw[key])
        if (value !== undefined && value.length > 0) {
            return value
        }
    }
    // iOS userInfo sometimes nests the id under a `gcm` object instead of using
    // the dotted key, and both shapes have to identify the same message.
    const nested = raw['gcm']
    if (isRecord(nested)) {
        const value = asText(nested['message_id'])
        if (value !== undefined && value.length > 0) {
            return value
        }
    }
    return undefined
}

/**
 * Flattens a native envelope into the public payload shape.
 *
 * Rules (docs/ARCHITECTURE.md §4):
 *  - trusted metadata wins over user keys;
 *  - colliding user keys are preserved under `custom.<key>`;
 *  - prototype-sensitive keys are dropped and recorded in `_fcm.dropped`;
 *  - an id-less message gets no dedup key, so unrelated messages never collapse.
 */
export const sanitizeNotificationPayload = (raw: unknown): INotificationPayload | null => {
    if (!isRecord(raw)) {
        return null
    }
    const envelope = raw as IRawNativeEnvelope
    const payload: Record<string, unknown> = {}
    const collisions: string[] = []
    const dropped: string[] = []

    assign(payload, 'wasTapped', envelope.wasTapped === true)
    const messageId = extractMessageId(envelope)
    if (messageId !== undefined) {
        assign(payload, 'messageId', messageId)
    }
    for (const key of ['title', 'subtitle', 'body'] as const) {
        const value = asText(envelope[key])
        if (value !== undefined) {
            assign(payload, key, value)
        }
    }
    const badge = asCount(envelope.badge)
    if (badge !== undefined) {
        assign(payload, 'badge', badge)
    }

    // Legacy 7.x bridges flattened everything into one map; a modern native core
    // sends the user map under `data`. Both shapes must produce the same result.
    const reserved = new Set<string>(RESERVED_KEYS)
    const userEntries: Array<[string, unknown]> = isRecord(envelope.data)
        ? Object.entries(envelope.data)
        : Object.entries(envelope).filter(([key]) => !reserved.has(key))

    for (const [key, value] of userEntries) {
        if (!safeKey(key)) {
            dropped.push(key)
            continue
        }
        if (reserved.has(key)) {
            collisions.push(key)
            const custom = (payload.custom as Record<string, unknown>) ?? {}
            if (payload.custom === undefined) {
                assign(payload, 'custom', custom)
            }
            if (safeKey(key)) {
                assign(custom, key, value)
            }
            continue
        }
        assign(payload, key, value)
    }

    if (collisions.length > 0 || dropped.length > 0) {
        const meta: Record<string, unknown> = {}
        if (collisions.length > 0) {
            assign(meta, 'collisions', collisions)
        }
        if (dropped.length > 0) {
            assign(meta, 'dropped', dropped)
        }
        assign(payload, '_fcm', meta)
    }

    return payload as INotificationPayload
}
