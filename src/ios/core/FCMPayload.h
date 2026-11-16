#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Payload sanitizer for the shared iOS native core. Mirrors src/core/payload.ts
 * rule-for-rule (docs/ARCHITECTURE.md §4):
 *
 *  - Trusted native metadata (wasTapped, title, subtitle, body, badge,
 *    messageId, custom, _fcm) can never be overwritten by sender `data`.
 *    A colliding user key is relocated to `custom.<key>` and named in
 *    `_fcm.collisions`.
 *  - Prototype-sensitive keys (__proto__, constructor, prototype) are dropped
 *    and recorded in `_fcm.dropped`; they are never copied onto the payload.
 *  - Canonical message id comes from messageId / gcm.message_id / _id /
 *    _fcm_message_id (or a nested `gcm.message_id` object). Messages without an
 *    id get no dedup key here; the event bus gives each such event a private
 *    monotonic key so unrelated messages never collapse.
 *  - An absent `data` map falls back to flattening the non-reserved envelope
 *    keys (legacy 7.x wire shape); both shapes produce the same payload.
 *  - plist-only values (NSDate, NSData, NSNull…) are converted or dropped so
 *    the payload is always JSON-serializable; NSNull keys are dropped
 *    (JS-side JSON.stringify drops undefined keys — same observable shape).
 *
 * All returned dictionaries are immutable; the startup tap payload stays
 * identical across reads.
 */
@interface FCMPayload : NSObject

/** Sanitizes a transport envelope ({wasTapped, messageId, title, subtitle,
 *  body, badge, data|flat user keys}) into the public payload shape. */
+ (NSDictionary *)sanitizeEnvelope:(NSDictionary *)envelope;

/** Convenience envelope built from a UNNotificationContent plus its userInfo. */
+ (NSDictionary *)sanitizeNotificationWithUserInfo:(nullable NSDictionary *)userInfo
                                             title:(nullable NSString *)title
                                            subtitle:(nullable NSString *)subtitle
                                                body:(nullable NSString *)body
                                                 badge:(nullable NSNumber *)badge
                                             wasTapped:(BOOL)wasTapped;

/** Canonical dedup id, or nil when the message carries none. */
+ (nullable NSString *)messageIdFromEnvelope:(NSDictionary *)envelope;

/** Wire event envelopes: ["notification", payload] / ["tokenRefresh", token]. */
+ (nullable NSString *)notificationEventJSON:(NSDictionary *)payload
                                       error:(NSError *_Nullable *_Nullable)error;
+ (nullable NSString *)tokenRefreshEventJSON:(NSString *)token
                                       error:(NSError *_Nullable *_Nullable)error;

@end

NS_ASSUME_NONNULL_END
