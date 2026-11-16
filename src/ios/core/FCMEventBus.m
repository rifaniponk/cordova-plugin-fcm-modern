#import "FCMEventBus.h"

static const NSUInteger kFCMEventQueueCapacity = 50;
static const NSUInteger kFCMDedupCapacity = 100;

@interface FCMEventBus ()
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *notificationQueue;
@property (nonatomic, strong) NSMutableArray<NSString *> *tokenQueue;
@property (nonatomic, strong) NSMutableOrderedSet<NSString *> *receiptKeys;
@property (nonatomic, strong) NSMutableOrderedSet<NSString *> *tapKeys;
@property (nonatomic, strong) NSMutableOrderedSet<NSString *> *tokenKeys;
@property (nonatomic, copy, nullable) FCMEventSink sink;
@property (nonatomic, assign) NSUInteger monotonicCounter;
@end

@implementation FCMEventBus

+ (instancetype)sharedBus {
    static FCMEventBus *sharedBus = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sharedBus = [[FCMEventBus alloc] init];
    });
    return sharedBus;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _notificationQueue = [NSMutableArray array];
        _tokenQueue = [NSMutableArray array];
        _receiptKeys = [NSMutableOrderedSet orderedSet];
        _tapKeys = [NSMutableOrderedSet orderedSet];
        _tokenKeys = [NSMutableOrderedSet orderedSet];
        _monotonicCounter = 0;
    }
    return self;
}

#pragma mark - enqueue

- (void)enqueueNotification:(NSDictionary *)payload tapped:(BOOL)tapped {
    @synchronized (self) {
        NSString *key = [self notificationKeyLocked:payload tapped:tapped];
        NSMutableOrderedSet<NSString *> *space = tapped ? self.tapKeys : self.receiptKeys;
        if ([space containsObject:key]) {
            return;  // duplicate within this identity space; the other space is unaffected
        }
        [self rememberKeyLocked:key inSpace:space];

        FCMEventSink liveSink = self.sink;
        if (liveSink != nil) {
            dispatch_async(dispatch_get_main_queue(), ^{ liveSink(@"notification", payload); });
            return;
        }
        [self.notificationQueue addObject:payload];
        if (self.notificationQueue.count > kFCMEventQueueCapacity) {
            [self.notificationQueue removeObjectAtIndex:0];
            NSLog(@"FCMModern: notification buffer full (%lu); dropped oldest buffered event",
                  (unsigned long)kFCMEventQueueCapacity);
        }
    }
}

- (void)enqueueTokenRefresh:(NSString *)token {
    if (![token isKindOfClass:[NSString class]] || token.length == 0) {
        return;
    }
    @synchronized (self) {
        if ([self.tokenKeys containsObject:token]) {
            return;
        }
        [self rememberKeyLocked:token inSpace:self.tokenKeys];

        FCMEventSink liveSink = self.sink;
        if (liveSink != nil) {
            dispatch_async(dispatch_get_main_queue(), ^{ liveSink(@"tokenRefresh", token); });
            return;
        }
        [self.tokenQueue addObject:token];
        if (self.tokenQueue.count > kFCMEventQueueCapacity) {
            [self.tokenQueue removeObjectAtIndex:0];
            NSLog(@"FCMModern: token buffer full (%lu); dropped oldest buffered event",
                  (unsigned long)kFCMEventQueueCapacity);
        }
    }
}

#pragma mark - sink lifecycle

- (void)attachSink:(FCMEventSink)sink {
    NSArray<NSDictionary *> *bufferedNotifications = nil;
    NSArray<NSString *> *bufferedTokens = nil;
    @synchronized (self) {
        self.sink = [sink copy];
        bufferedNotifications = [self.notificationQueue copy];
        bufferedTokens = [self.tokenQueue copy];
        [self.notificationQueue removeAllObjects];
        [self.tokenQueue removeAllObjects];
    }
    // Chronological replay per space: notifications first, then tokens.
    dispatch_async(dispatch_get_main_queue(), ^{
        for (NSDictionary *payload in bufferedNotifications) {
            sink(@"notification", payload);
        }
        for (NSString *token in bufferedTokens) {
            sink(@"tokenRefresh", token);
        }
    });
}

- (void)detachSink:(FCMEventSink _Nullable)sink {
    @synchronized (self) {
        if (sink != nil && self.sink != sink) {
            return;
        }
        self.sink = nil;  // events queued after this point stay buffered for the next sink
    }
}

- (void)replayBufferedEventsToSink:(FCMEventSink)sink {
    NSArray<NSDictionary *> *bufferedNotifications = nil;
    NSArray<NSString *> *bufferedTokens = nil;
    @synchronized (self) {
        bufferedNotifications = [self.notificationQueue copy];
        bufferedTokens = [self.tokenQueue copy];
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        for (NSDictionary *payload in bufferedNotifications) {
            sink(@"notification", payload);
        }
        for (NSString *token in bufferedTokens) {
            sink(@"tokenRefresh", token);
        }
    });
}

#pragma mark - internals (callers hold @synchronized(self))

- (NSString *)notificationKeyLocked:(NSDictionary *)payload tapped:(BOOL)tapped {
    // Canonical id when present; otherwise a bus-private monotonic id so
    // id-less messages never collapse into each other.
    NSString *messageId = payload[@"messageId"];
    if ([messageId isKindOfClass:[NSString class]] && messageId.length > 0) {
        return messageId;
    }
    self.monotonicCounter += 1;
    return [NSString stringWithFormat:@"fcm-local-%lu", (unsigned long)self.monotonicCounter];
}

- (void)rememberKeyLocked:(NSString *)key inSpace:(NSMutableOrderedSet<NSString *> *)space {
    if (space.count >= kFCMDedupCapacity) {
        [space removeObjectAtIndex:0];
    }
    [space addObject:key];
}

@end
