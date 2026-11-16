#import "FCMNotificationDelegate.h"
#import "FCMEventBus.h"
#import "FCMModernCore.h"
#import "FCMPayload.h"

static const NSTimeInterval kFCMChainedDelegateFallback = 3.0;

@implementation FCMNotificationDelegate

// Foreground receipt: event-only by default; presentation is opt-in via
// FCMModernCore.foregroundPresentationOptions.
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler {
    UNNotificationContent *content = notification.request.content;
    NSDictionary *payload = [FCMPayload sanitizeNotificationWithUserInfo:content.userInfo
                                                                    title:content.title
                                                                  subtitle:content.subtitle
                                                                      body:content.body
                                                                       badge:content.badge
                                                                  wasTapped:NO];
    [[FCMEventBus sharedBus] enqueueNotification:payload tapped:NO];

    __block UNNotificationPresentationOptions merged = [FCMModernCore sharedCore].foregroundPresentationOptions;
    __block dispatch_once_t onceToken = 0;
    void (^finish)(void) = ^{
        dispatch_once(&onceToken, ^{ completionHandler(merged); });
    };

    id<UNUserNotificationCenterDelegate> chained = self.previousDelegate;
    SEL forward = @selector(userNotificationCenter:willPresentNotification:withCompletionHandler:);
    if ([chained respondsToSelector:forward]) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [chained userNotificationCenter:center
                       willPresentNotification:notification
                       withCompletionHandler:^(UNNotificationPresentationOptions extraOptions) {
                @synchronized (self) {
                    merged |= extraOptions;
                }
                finish();
            }];
        });
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kFCMChainedDelegateFallback * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), finish);
    } else {
        dispatch_async(dispatch_get_main_queue(), ^{ finish(); });
    }
}

// Tap: tap identity space, and the startup tap payload for getInitialPushPayload().
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       didReceiveNotificationResponse:(UNNotificationResponse *)response
                withCompletionHandler:(void (^)(void))completionHandler {
    UNNotificationContent *content = response.notification.request.content;
    NSDictionary *payload = [FCMPayload sanitizeNotificationWithUserInfo:content.userInfo
                                                                    title:content.title
                                                                  subtitle:content.subtitle
                                                                      body:content.body
                                                                       badge:content.badge
                                                                  wasTapped:YES];
    [[FCMEventBus sharedBus] enqueueNotification:payload tapped:YES];
    [[FCMModernCore sharedCore] noteTapPayload:payload];

    __block dispatch_once_t onceToken = 0;
    void (^finish)(void) = ^{
        dispatch_once(&onceToken, ^{ completionHandler(); });
    };

    id<UNUserNotificationCenterDelegate> chained = self.previousDelegate;
    SEL forward = @selector(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:);
    if ([chained respondsToSelector:forward]) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [chained userNotificationCenter:center
                didReceiveNotificationResponse:response
                     withCompletionHandler:^{ finish(); }];
        });
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kFCMChainedDelegateFallback * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), finish);
    } else {
        dispatch_async(dispatch_get_main_queue(), ^{ finish(); });
    }
}

@end
