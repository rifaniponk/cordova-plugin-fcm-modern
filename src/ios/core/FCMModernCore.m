#import "FCMModernCore.h"
#import "FCMEventBus.h"
#import "FCMNotificationDelegate.h"
#import "FCMPayload.h"

@import FirebaseCore;
@import FirebaseMessaging;
@import UserNotifications;

NSString *const FCMModernErrorDomain = @"FCMModern";

static const NSTimeInterval kFCMTokenDefaultTimeout = 10.0;
static const NSTimeInterval kFCMDeleteDefaultTimeout = 20.0;
static const NSTimeInterval kFCMAPNSDefaultTimeout = 10.0;

typedef void (^FCMValueCompletion)(NSString *_Nullable value, NSError *_Nullable error);
typedef void (^FCMVoidCompletion)(NSError *_Nullable error);

/** Wraps a completion so it can be invoked at most once (success OR timeout). */
static FCMValueCompletion FCMGuardValue(FCMValueCompletion completion) {
    __block dispatch_once_t onceToken = 0;
    return ^(NSString *_Nullable value, NSError *_Nullable error) {
        dispatch_once(&onceToken, ^{ completion(value, error); });
    };
}

static FCMVoidCompletion FCMGuardVoid(FCMVoidCompletion completion) {
    __block dispatch_once_t onceToken = 0;
    return ^(NSError *_Nullable error) {
        dispatch_once(&onceToken, ^{ completion(error); });
    };
}

static NSError *FCMError(FCMModernError code, NSString *message) {
    return [NSError errorWithDomain:FCMModernErrorDomain code:code userInfo:@{ NSLocalizedDescriptionKey: message }];
}

static NSString *FCMHexString(NSData *data) {
    NSMutableString *hex = [NSMutableString stringWithCapacity:data.length * 2];
    const unsigned char *bytes = data.bytes;
    for (NSUInteger i = 0; i < data.length; i++) {
        [hex appendFormat:@"%02x", bytes[i]];
    }
    return [hex copy];
}

@interface FCMModernCore () <FIRMessagingDelegate>
@end

@implementation FCMModernCore {
    BOOL _bootstrapped;
    NSString *_fcmToken;
    NSString *_installationId;
    NSString *_apnsTokenHex;
    NSMutableArray<FCMValueCompletion> *_tokenWaiters;
    NSMutableArray<FCMValueCompletion> *_registrationWaiters;
    NSMutableArray<FCMValueCompletion> *_apnsWaiters;
    NSDictionary *_initialPayload;
    UNNotificationPresentationOptions _presentationOptions;
    FCMNotificationDelegate *_notificationDelegate;
}

+ (instancetype)sharedCore {
    static FCMModernCore *sharedCore = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sharedCore = [[FCMModernCore alloc] init];
    });
    return sharedCore;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _tokenWaiters = [NSMutableArray array];
        _registrationWaiters = [NSMutableArray array];
        _apnsWaiters = [NSMutableArray array];
        _presentationOptions = UNNotificationPresentationOptionNone;  // event-only by default
        _notificationDelegate = [[FCMNotificationDelegate alloc] init];
    }
    return self;
}

#pragma mark - bootstrap

- (FCMEventBus *)eventBus {
    return [FCMEventBus sharedBus];
}

- (void)bootstrap {
    @synchronized (self) {
        if (_bootstrapped) {
            return;
        }
        _bootstrapped = YES;
    }
    [self ensureConfigured];
    [FIRMessaging messaging].delegate = self;
    dispatch_async(dispatch_get_main_queue(), ^{
        UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
        @synchronized (self) {
            if (center.delegate != self->_notificationDelegate) {
                self->_notificationDelegate.previousDelegate = center.delegate;
                center.delegate = self->_notificationDelegate;
            }
        }
    });
}

- (BOOL)isBootstrapped {
    @synchronized (self) {
        return _bootstrapped;
    }
}

/** Configures Firebase if the host has not; returns an error when configuration fails. */
- (NSError *_Nullable)ensureConfigured {
    @try {
        if ([FIRApp defaultApp] == nil) {
            [FIRApp configure];
        }
        (void)[FIRMessaging messaging];
        return nil;
    } @catch (NSException *exception) {
        return FCMError(FCMModernErrorConfig,
                        [NSString stringWithFormat:@"Firebase configuration failed (%@). "
                                                   @"Add GoogleService-Info.plist via your build pipeline (never commit a real one).",
                                                   exception.name]);
    }
}

#pragma mark - token / registration

- (BOOL)usesInstallationIdRegistration {
    return [FIRMessaging messaging].isInstallationIdEnabled;
}

- (void)getTokenWithTimeout:(NSTimeInterval)timeout completion:(void (^)(NSString *_Nullable, NSError *_Nullable))completion {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSError *configError = [self ensureConfigured];
        if (configError != nil) {
            completion(nil, configError);
            return;
        }
        FCMValueCompletion done = FCMGuardValue(completion);
        BOOL useFid = [self usesInstallationIdRegistration];
        NSMutableArray<FCMValueCompletion> *space = nil;
        @synchronized (self) {
            NSString *existing = useFid ? self->_installationId : self->_fcmToken;
            if (existing.length > 0) {
                done(existing, nil);
                return;
            }
            space = useFid ? self->_registrationWaiters : self->_tokenWaiters;
            [space addObject:done];
        }

        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            [self resolveWaitersInSpace:space
                                  value:nil
                                  error:FCMError(FCMModernErrorTimeout,
                                                  @"FCM token/registration not ready within the bounded timeout. "
                                                  @"Check connectivity, Firebase configuration and auto-init state.")];
        });

        if (useFid) {
            // Current registration model: completion reports errors; the FID is
            // delivered via messaging:didReceiveRegistration: below.
            [[FIRMessaging messaging] registerWithCompletion:^(NSError *_Nullable error) {
                if (error != nil) {
                    [self resolveWaitersInSpace:space value:nil error:FCMError(FCMModernErrorToken, error.localizedDescription)];
                }
            }];
        } else {
            [[FIRMessaging messaging] tokenWithCompletion:^(NSString *_Nullable token, NSError *_Nullable error) {
                if (error != nil) {
                    [self resolveWaitersInSpace:space value:nil error:FCMError(FCMModernErrorToken, error.localizedDescription)];
                } else if (token.length > 0) {
                    @synchronized (self) {
                        self->_fcmToken = [token copy];
                    }
                    [self resolveWaitersInSpace:space value:token error:nil];
                }
                // token == nil && error == nil leaves the waiter on the bounded timeout.
            }];
        }
    });
}

- (void)deleteTokenWithCompletion:(void (^)(NSError *_Nullable))completion {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSError *configError = [self ensureConfigured];
        if (configError != nil) {
            completion(configError);
            return;
        }
        FCMVoidCompletion done = FCMGuardVoid(^(NSError *_Nullable error) {
            if (error == nil) {
                @synchronized (self) {
                    self->_fcmToken = nil;
                    self->_installationId = nil;
                }
            }
            completion(error);
        });
        // Token-only deletion: never Installations.delete / "installation" removal.
        if ([self usesInstallationIdRegistration]) {
            [[FIRMessaging messaging] unregisterWithCompletion:^(NSError *_Nullable error) { done(error); }];
        } else {
            [[FIRMessaging messaging] deleteTokenWithCompletion:^(NSError *_Nullable error) { done(error); }];
        }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kFCMDeleteDefaultTimeout * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            done(FCMError(FCMModernErrorTimeout, @"FCM token deletion did not complete within the bounded timeout."));
        });
    });
}

#pragma mark - FIRMessagingDelegate

- (void)messaging:(FIRMessaging *)messaging didReceiveRegistrationToken:(NSString *_Nullable)fcmToken {
    // Legacy token model still fires this; the registration model uses the FID below.
    if (fcmToken.length == 0) {
        return;  // never enqueue an empty token
    }
    @synchronized (self) {
        _fcmToken = [fcmToken copy];
    }
    [[FCMEventBus sharedBus] enqueueTokenRefresh:fcmToken];
    [self resolveWaitersInSpace:_tokenWaiters value:fcmToken error:nil];
}

- (void)messaging:(FIRMessaging *)messaging didReceiveRegistration:(NSString *_Nullable)installationId {
    // Under the installation-id model the FID is the app-instance registration
    // handed to app servers; it is what getToken()/tokenRefresh report.
    if (installationId.length == 0) {
        return;
    }
    @synchronized (self) {
        _installationId = [installationId copy];
    }
    [[FCMEventBus sharedBus] enqueueTokenRefresh:installationId];
    [self resolveWaitersInSpace:_registrationWaiters value:installationId error:nil];
}

- (void)messaging:(FIRMessaging *)messaging didUnregister:(NSString *)installationId {
    // Intentionally ignored: unregistration is surfaced through deleteToken()'s completion.
}

- (void)resolveWaitersInSpace:(NSMutableArray<FCMValueCompletion> *)waiters
                        value:(NSString *_Nullable)value
                        error:(NSError *_Nullable)error {
    NSArray<FCMValueCompletion> *snapshot = nil;
    @synchronized (self) {
        snapshot = [waiters copy];
        [waiters removeAllObjects];
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        for (FCMValueCompletion waiter in snapshot) {
            waiter(value, error);
        }
    });
}

#pragma mark - APNs readiness (bounded, with error path)

- (void)waitForAPNSTokenWithTimeout:(NSTimeInterval)timeout completion:(void (^)(NSString *_Nullable, NSError *_Nullable))completion {
    dispatch_async(dispatch_get_main_queue(), ^{
        FCMValueCompletion done = FCMGuardValue(completion);
        NSMutableArray<FCMValueCompletion> *waiters = nil;
        @synchronized (self) {
            if (self->_apnsTokenHex.length > 0) {
                done(self->_apnsTokenHex, nil);
                return;
            }
            waiters = self->_apnsWaiters;
            [waiters addObject:done];
        }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            [self resolveWaitersInSpace:waiters
                                  value:nil
                                  error:FCMError(FCMModernErrorTimeout,
                                                  @"APNs device token not received within the bounded timeout. "
                                                  @"Check the aps-environment entitlement, provisioning profile, "
                                                  @"AppDelegate forwarding, and note that simulators never get APNs tokens.")];
        });
    });
}

- (void)noteAPNsDeviceToken:(NSData *)deviceTokenData {
    if (deviceTokenData.length == 0) {
        return;
    }
    NSString *hex = FCMHexString(deviceTokenData);
    NSArray<FCMValueCompletion> *snapshot = nil;
    @synchronized (self) {
        _apnsTokenHex = hex;
        snapshot = [_apnsWaiters copy];
        [_apnsWaiters removeAllObjects];
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        [FIRMessaging messaging].APNSToken = deviceTokenData;  // associates APNs with the FCM registration
        for (FCMValueCompletion waiter in snapshot) {
            waiter(hex, nil);
        }
    });
}

- (void)noteAPNsRegistrationFailed:(NSError *)error {
    NSArray<FCMValueCompletion> *snapshot = nil;
    @synchronized (self) {
        snapshot = [_apnsWaiters copy];
        [_apnsWaiters removeAllObjects];
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        NSError *wrapped = FCMError(FCMModernErrorAPNS,
                                    [NSString stringWithFormat:@"APNs registration failed: %@", error.localizedDescription]);
        for (FCMValueCompletion waiter in snapshot) {
            waiter(nil, wrapped);
        }
    });
}

#pragma mark - permission

- (void)hasPermissionWithCompletion:(void (^)(NSNumber *))completion {
    dispatch_async(dispatch_get_main_queue(), ^{
        [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
            BOOL granted = settings.authorizationStatus == UNAuthorizationStatusAuthorized
                        || settings.authorizationStatus == UNAuthorizationStatusProvisional;
            dispatch_async(dispatch_get_main_queue(), ^{ completion(@(granted)); });
        }];
    });
}

- (void)requestPushPermissionWithCompletion:(void (^)(BOOL, NSError *_Nullable))completion {
    dispatch_async(dispatch_get_main_queue(), ^{
        [[UNUserNotificationCenter currentNotificationCenter]
            requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge)
            completionHandler:^(BOOL granted, NSError *_Nullable error) {
                if (granted) {
                    dispatch_async(dispatch_get_main_queue(), ^{
                        [[UIApplication sharedApplication] registerForRemoteNotifications];
                    });
                }
                completion(granted, error);
            }];
    });
}

#pragma mark - topics (resolve only after the SDK operation finishes)

- (void)subscribeToTopic:(NSString *)topic completion:(void (^)(NSError *_Nullable))completion {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSError *configError = [self ensureConfigured];
        if (configError != nil) {
            completion(configError);
            return;
        }
        [[FIRMessaging messaging] subscribeToTopic:topic completion:^(NSError *_Nullable error) {
            completion(error);
        }];
    });
}

- (void)unsubscribeFromTopic:(NSString *)topic completion:(void (^)(NSError *_Nullable))completion {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSError *configError = [self ensureConfigured];
        if (configError != nil) {
            completion(configError);
            return;
        }
        [[FIRMessaging messaging] unsubscribeFromTopic:topic completion:^(NSError *_Nullable error) {
            completion(error);
        }];
    });
}

#pragma mark - presentation / notifications / auto-init

- (void)clearAllNotifications {
    dispatch_async(dispatch_get_main_queue(), ^{
        [[UNUserNotificationCenter currentNotificationCenter] removeAllDeliveredNotifications];
        [UIApplication sharedApplication].applicationIconBadgeNumber = 0;
    });
}

- (void)setAutoInitEnabled:(BOOL)enabled {
    dispatch_async(dispatch_get_main_queue(), ^{
        [FIRMessaging messaging].autoInitEnabled = enabled;
    });
}

- (BOOL)isAutoInitEnabled {
    return [FIRMessaging messaging].isAutoInitEnabled;
}

- (void)setForegroundPresentationOptions:(UNNotificationPresentationOptions)options {
    @synchronized (self) {
        _presentationOptions = options;
    }
}

- (UNNotificationPresentationOptions)foregroundPresentationOptions {
    @synchronized (self) {
        return _presentationOptions;
    }
}

#pragma mark - startup payload

- (NSDictionary *_Nullable)initialPushPayload {
    @synchronized (self) {
        return [_initialPayload copy];  // stable across reads; never consumed
    }
}

- (void)noteTapPayload:(NSDictionary *)payload {
    @synchronized (self) {
        if (_initialPayload == nil) {
            _initialPayload = [payload copy];  // first startup tap wins
        }
    }
}

#pragma mark - remote notification forwarding

- (void)forwardRemoteNotification:(NSDictionary *)userInfo {
    if (![userInfo isKindOfClass:[NSDictionary class]]) {
        return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        [[FIRMessaging messaging] appDidReceiveMessage:userInfo];  // informs the SDK; no Analytics

        BOOL wasTapped = [UIApplication sharedApplication].applicationState == UIApplicationStateInactive;
        NSMutableDictionary *envelope = [NSMutableDictionary dictionary];
        envelope[@"wasTapped"] = @(wasTapped);
        envelope[@"data"] = userInfo;
        NSDictionary *aps = [userInfo[@"aps"] isKindOfClass:[NSDictionary class]] ? userInfo[@"aps"] : nil;
        if ([aps[@"alert"] isKindOfClass:[NSString class]]) {
            envelope[@"body"] = aps[@"alert"];
        } else if ([aps[@"alert"] isKindOfClass:[NSDictionary class]]) {
            NSDictionary *alert = aps[@"alert"];
            if ([alert[@"title"] isKindOfClass:[NSString class]]) envelope[@"title"] = alert[@"title"];
            if ([alert[@"subtitle"] isKindOfClass:[NSString class]]) envelope[@"subtitle"] = alert[@"subtitle"];
            if ([alert[@"body"] isKindOfClass:[NSString class]]) envelope[@"body"] = alert[@"body"];
        }
        if ([aps[@"badge"] isKindOfClass:[NSNumber class]]) {
            envelope[@"badge"] = aps[@"badge"];
        }
        NSDictionary *payload = [FCMPayload sanitizeEnvelope:envelope];
        [[FCMEventBus sharedBus] enqueueNotification:payload tapped:wasTapped];
        if (wasTapped) {
            [self noteTapPayload:payload];
        }
    });
}

@end
