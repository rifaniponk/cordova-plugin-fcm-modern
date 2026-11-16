#import "FCMPayload.h"
#include <math.h>

// Exact mirrors of src/core/payload.ts constants.
static NSArray<NSString *> *FCMReservedKeys(void) {
    return @[ @"wasTapped", @"title", @"subtitle", @"body", @"badge", @"messageId", @"custom", @"_fcm" ];
}

static NSArray<NSString *> *FCMUnsafeKeys(void) {
    return @[ @"__proto__", @"constructor", @"prototype" ];
}

static BOOL FCMIsUnsafeKey(NSString *key) {
    return [FCMUnsafeKeys() containsObject:key];
}

static BOOL FCMIsReservedKey(NSString *key) {
    return [FCMReservedKeys() containsObject:key];
}

/** payload.ts `asText`: strings pass through, numbers stringify, anything else is undefined. */
static NSString *_Nullable FCMAsText(id value) {
    if ([value isKindOfClass:[NSString class]]) {
        return value;
    }
    if ([value isKindOfClass:[NSNumber class]]) {
        return [value stringValue];
    }
    return nil;
}

/** payload.ts `asCount`: finite numbers only; numeric strings parse, others fail. */
static NSNumber *_Nullable FCMAsCount(id value) {
    if ([value isKindOfClass:[NSNumber class]]) {
        double numeric = [value doubleValue];
        return isfinite(numeric) ? @(numeric) : nil;
    }
    if ([value isKindOfClass:[NSString class]]) {
        NSScanner *scanner = [NSScanner scannerWithString:value];
        float scanned = 0.0f;
        if ([scanner scanFloat:&scanned] && scanner.isAtEnd) {
            return @((double)scanned);
        }
    }
    return nil;
}

/**
 * JSON-safe conversion for plist values that NSJSONSerialization cannot encode.
 * NSNull maps to nil (dropped): JS JSON.stringify drops `undefined` keys, so the
 * observable payload shape matches the TS sanitizer.
 */
static id _Nullable FCMJSONSafeValue(id value) {
    if ([value isKindOfClass:[NSNull class]]) {
        return nil;
    }
    if ([value isKindOfClass:[NSString class]] || [value isKindOfClass:[NSNumber class]]) {
        return value;
    }
    if ([value isKindOfClass:[NSDate class]]) {
        return [[NSISO8601DateFormatter new] stringFromDate:value];
    }
    if ([value isKindOfClass:[NSData class]]) {
        return [(NSData *)value base64EncodedStringWithOptions:0];
    }
    if ([value isKindOfClass:[NSURL class]]) {
        return [(NSURL *)value absoluteString];
    }
    if ([value isKindOfClass:[NSDictionary class]]) {
        NSMutableDictionary *safe = [NSMutableDictionary dictionary];
        [(NSDictionary *)value enumerateKeysAndObjectsUsingBlock:^(NSString *key, id object, BOOL *stop) {
            if (![key isKindOfClass:[NSString class]]) {
                return;
            }
            id safeObject = FCMJSONSafeValue(object);
            if (safeObject != nil) {
                safe[key] = safeObject;
            }
        }];
        return [safe copy];
    }
    if ([value isKindOfClass:[NSArray class]]) {
        NSMutableArray *safe = [NSMutableArray array];
        for (id object in (NSArray *)value) {
            id safeObject = FCMJSONSafeValue(object);
            if (safeObject != nil) {
                [safe addObject:safeObject];
            }
        }
        return [safe copy];
    }
    return nil;  // not JSON-representable; JS would drop the key as undefined
}

@implementation FCMPayload

+ (NSDictionary *)sanitizeEnvelope:(NSDictionary *)raw {
    if (![raw isKindOfClass:[NSDictionary class]]) {
        return @{};
    }

    NSMutableDictionary *payload = [NSMutableDictionary dictionary];
    NSMutableArray<NSString *> *collisions = [NSMutableArray array];
    NSMutableArray<NSString *> *dropped = [NSMutableArray array];
    NSMutableDictionary *custom = nil;

    // Trusted metadata always wins (payload.ts assigns these first).
    BOOL wasTapped = [raw[@"wasTapped"] isKindOfClass:[NSNumber class]] && [raw[@"wasTapped"] boolValue];
    payload[@"wasTapped"] = @(wasTapped);

    NSString *messageId = [self messageIdFromEnvelope:raw];
    if (messageId != nil) {
        payload[@"messageId"] = messageId;
    }
    for (NSString *key in @[ @"title", @"subtitle", @"body" ]) {
        NSString *text = FCMAsText(raw[key]);
        if (text != nil) {
            payload[key] = text;
        }
    }
    NSNumber *badge = FCMAsCount(raw[@"badge"]);
    if (badge != nil) {
        payload[@"badge"] = badge;
    }

    // Legacy bridges flattened everything into one map; modern cores send the
    // sender map under `data`. Both shapes flatten identically.
    NSDictionary *data = [raw[@"data"] isKindOfClass:[NSDictionary class]] ? raw[@"data"] : nil;
    NSArray<NSString *> *userKeys;
    if (data != nil) {
        userKeys = data.allKeys;
    } else {
        NSMutableArray<NSString *> *flatKeys = [NSMutableArray array];
        for (NSString *key in raw.allKeys) {
            if (!FCMIsReservedKey(key)) {
                [flatKeys addObject:key];
            }
        }
        userKeys = flatKeys;
    }

    for (NSString *key in userKeys) {
        id value = data != nil ? data[key] : raw[key];
        if (FCMIsUnsafeKey(key)) {
            [dropped addObject:key];
            continue;
        }
        id safeValue = FCMJSONSafeValue(value);
        if (safeValue == nil) {
            continue;  // not JSON-representable; JS would drop undefined too
        }
        if (FCMIsReservedKey(key)) {
            [collisions addObject:key];
            if (custom == nil) {
                custom = [NSMutableDictionary dictionary];
                payload[@"custom"] = custom;
            }
            custom[key] = safeValue;
            continue;
        }
        payload[key] = safeValue;
    }

    if (collisions.count > 0 || dropped.count > 0) {
        NSMutableDictionary *meta = [NSMutableDictionary dictionary];
        if (collisions.count > 0) {
            meta[@"collisions"] = [collisions copy];
        }
        if (dropped.count > 0) {
            meta[@"dropped"] = [dropped copy];
        }
        payload[@"_fcm"] = [meta copy];
    }

    return [payload copy];
}

+ (NSDictionary *)sanitizeNotificationWithUserInfo:(NSDictionary *_Nullable)userInfo
                                             title:(NSString *_Nullable)title
                                            subtitle:(NSString *_Nullable)subtitle
                                                body:(NSString *_Nullable)body
                                                 badge:(NSNumber *_Nullable)badge
                                             wasTapped:(BOOL)wasTapped {
    NSMutableDictionary *envelope = [NSMutableDictionary dictionary];
    envelope[@"wasTapped"] = @(wasTapped);
    if (title != nil) { envelope[@"title"] = title; }
    if (subtitle != nil) { envelope[@"subtitle"] = subtitle; }
    if (body != nil) { envelope[@"body"] = body; }
    if (badge != nil) { envelope[@"badge"] = badge; }
    if ([userInfo isKindOfClass:[NSDictionary class]]) {
        envelope[@"data"] = userInfo;
    }
    return [self sanitizeEnvelope:envelope];
}

+ (NSString *_Nullable)messageIdFromEnvelope:(NSDictionary *)envelope {
    if (![envelope isKindOfClass:[NSDictionary class]]) {
        return nil;
    }
    for (NSString *key in @[ @"messageId", @"gcm.message_id", @"_id", @"_fcm_message_id" ]) {
        NSString *value = FCMAsText(envelope[key]);
        if (value != nil && value.length > 0) {
            return value;
        }
    }
    // iOS userInfo sometimes nests the id under a `gcm` object instead of using
    // the dotted key; both shapes must identify the same message.
    NSDictionary *nested = [envelope[@"gcm"] isKindOfClass:[NSDictionary class]] ? envelope[@"gcm"] : nil;
    NSString *nestedValue = FCMAsText(nested[@"message_id"]);
    if (nestedValue != nil && nestedValue.length > 0) {
        return nestedValue;
    }
    return nil;
}

+ (NSString *_Nullable)notificationEventJSON:(NSDictionary *)payload error:(NSError *_Nullable *_Nullable)error {
    return [self eventJSONWithName:@"notification" value:payload error:error];
}

+ (NSString *_Nullable)tokenRefreshEventJSON:(NSString *)token error:(NSError *_Nullable *_Nullable)error {
    return [self eventJSONWithName:@"tokenRefresh" value:token error:error];
}

+ (NSString *_Nullable)eventJSONWithName:(NSString *)name value:(id)value error:(NSError *_Nullable *_Nullable)error {
    NSArray *envelope = @[ name, value ];
    NSData *json = [NSJSONSerialization dataWithJSONObject:envelope options:0 error:error];
    if (json == nil) {
        return nil;
    }
    return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
}

@end
