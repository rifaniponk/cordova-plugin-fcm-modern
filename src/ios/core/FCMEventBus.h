#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** Live event sink: kind is "notification" (payload dict) or "tokenRefresh" (token string). */
typedef void (^FCMEventSink)(NSString *eventKind, id eventPayload);

/**
 * Runtime-free event bus for the shared iOS core (docs/ARCHITECTURE.md §4).
 *
 *  - Native-first buffering: notification and tokenRefresh events are queued
 *    before any JS bridge exists (cold start from a tap, bridge not started yet).
 *    Bounded FIFO (50 events); the oldest event is dropped with a native log
 *    line that never contains payload or token content.
 *  - Two independent identity spaces for dedup: receipt (wasTapped:false) and
 *    tap (wasTapped:true). A tap for a message whose receipt was already
 *    delivered is NOT suppressed. Dedup key = canonical message id when present,
 *    otherwise a bus-private monotonic id, so id-less messages never collapse
 *    into each other. Bounded LRU per space (100 keys).
 *  - One sink at a time. Attaching replays the buffered events chronologically
 *    (per space) and drains the queue; detaching a destroyed bridge drops the
 *    sink without losing events queued afterwards or before attach.
 *  - All public methods are thread-safe; sinks run on the main queue.
 */
@interface FCMEventBus : NSObject

+ (instancetype)sharedBus NS_SWIFT_NAME(shared());

/** Queues or live-delivers a sanitized notification payload; dedups per space. */
- (void)enqueueNotification:(NSDictionary *)payload tapped:(BOOL)tapped NS_SWIFT_NAME(enqueue(notification:tapped:));

/** Queues or live-delivers a token refresh; dedups by token value. */
- (void)enqueueTokenRefresh:(NSString *)token NS_SWIFT_NAME(enqueueTokenRefresh(_:));

/** Attaches a live sink and immediately replays + drains buffered events. */
- (void)attachSink:(FCMEventSink)sink NS_SWIFT_NAME(attach(sink:));

/** Detaches the given sink (pointer identity); buffered events stay intact. */
- (void)detachSink:(FCMEventSink _Nullable)sink NS_SWIFT_NAME(detach(sink:));

/** Re-delivers the currently buffered events without draining (manual replay). */
- (void)replayBufferedEventsToSink:(FCMEventSink)sink NS_SWIFT_NAME(replay(sink:));

@end

NS_ASSUME_NONNULL_END
