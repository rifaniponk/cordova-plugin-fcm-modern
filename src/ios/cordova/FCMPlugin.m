#import "FCMPlugin.h"
#import "FCMEventBus.h"
#import "FCMModernCore.h"
#import "FCMPayload.h"

#import <UserNotifications/UserNotifications.h>

static const NSTimeInterval kFCMTokenBridgeTimeout = 10.0;
static const NSTimeInterval kFCMAPNSBridgeTimeout = 10.0;

@implementation FCMPlugin {
    NSString *_bridgeCallbackId;
    FCMEventSink _bridgeSink;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        [[FCMModernCore sharedCore] bootstrap];  // event capture starts before any bridge exists
    }
    return self;
}

- (void)dealloc {
    // A destroyed bridge detaches its sink; queued events stay buffered.
    [[FCMEventBus sharedBus] detachSink:_bridgeSink];
}

#pragma mark - result helpers

- (void)sendOK:(NSString *)callbackId value:(id _Nullable)value {
    CDVPluginResult *result = value == nil
        ? [CDVPluginResult resultWithStatus:CDVCommandStatus_OK]
        : [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:(NSString *)value];
    [self.commandDelegate sendPluginResult:result callbackId:callbackId];
}

- (void)sendOKDictionary:(NSString *)callbackId dictionary:(NSDictionary *_Nullable)dictionary {
    CDVPluginResult *result = dictionary == nil
        ? [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:nil]  // payload null
        : [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:dictionary];
    [self.commandDelegate sendPluginResult:result callbackId:callbackId];
}

- (void)sendOKBool:(NSString *)callbackId value:(BOOL)value {
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsBool:value]
                                callbackId:callbackId];
}

- (void)sendError:(NSString *)callbackId message:(NSString *)message {
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:message]
                                callbackId:callbackId];
}

#pragma mark - lifecycle

- (void)ready:(CDVInvokedUrlCommand *)command {
    [[FCMModernCore sharedCore] bootstrap];
    [self sendOK:command.callbackId value:nil];
}

#pragma mark - token / APNs / payload

- (void)getToken:(CDVInvokedUrlCommand *)command {
    NSString *callbackId = command.callbackId;
    [[FCMModernCore sharedCore] getTokenWithTimeout:kFCMTokenBridgeTimeout
                                         completion:^(NSString *_Nullable token, NSError *_Nullable error) {
        if (token.length > 0) {
            [self sendOK:callbackId value:token];
        } else {
            [self sendError:callbackId message:error.localizedDescription ?: @"FCM token unavailable"];
        }
    }];
}

- (void)deleteToken:(CDVInvokedUrlCommand *)command {
    NSString *callbackId = command.callbackId;
    [[FCMModernCore sharedCore] deleteTokenWithCompletion:^(NSError *_Nullable error) {
        if (error == nil) {
            [self sendOK:callbackId value:nil];
        } else {
            [self sendError:callbackId message:error.localizedDescription];
        }
    }];
}

// Compatibility alias: deletes the messaging token/registration only,
// never the Firebase installation (Installations.delete is never called).
- (void)deleteInstanceId:(CDVInvokedUrlCommand *)command {
    [self deleteToken:command];
}

- (void)getInitialPushPayload:(CDVInvokedUrlCommand *)command {
    NSDictionary *payload = [[FCMModernCore sharedCore] initialPushPayload];
    [self sendOKDictionary:command.callbackId dictionary:payload];
}

- (void)getAPNSToken:(CDVInvokedUrlCommand *)command {
    NSString *callbackId = command.callbackId;
    [[FCMModernCore sharedCore] waitForAPNSTokenWithTimeout:kFCMAPNSBridgeTimeout
                                                 completion:^(NSString *_Nullable apnsToken, NSError *_Nullable error) {
        if (apnsToken.length > 0) {
            [self sendOK:callbackId value:apnsToken];
        } else {
            [self sendError:callbackId message:error.localizedDescription ?: @"APNs token unavailable"];
        }
    }];
}

#pragma mark - permission

- (void)hasPermission:(CDVInvokedUrlCommand *)command {
    NSString *callbackId = command.callbackId;
    [[FCMModernCore sharedCore] hasPermissionWithCompletion:^(NSNumber *granted) {
        [self sendOKBool:callbackId value:granted.boolValue];
    }];
}

// The ios9Support timeout/interval options are accepted and ignored (deprecated).
- (void)requestPushPermission:(CDVInvokedUrlCommand *)command {
    NSString *callbackId = command.callbackId;
    [[FCMModernCore sharedCore] requestPushPermissionWithCompletion:^(BOOL granted, NSError *_Nullable error) {
        if (error == nil) {
            [self sendOKBool:callbackId value:granted];
        } else {
            [self sendError:callbackId message:error.localizedDescription];
        }
    }];
}

#pragma mark - topics

- (NSString *_Nullable)topicFromCommand:(CDVInvokedUrlCommand *)command {
    NSString *topic = [command.arguments count] > 0 ? command.arguments[0] : nil;
    return [topic isKindOfClass:[NSString class]] && topic.length > 0 ? topic : nil;
}

- (void)subscribeToTopic:(CDVInvokedUrlCommand *)command {
    NSString *topic = [self topicFromCommand:command];
    if (topic == nil) {
        [self sendError:command.callbackId message:@"subscribeToTopic requires a non-empty topic string"];
        return;
    }
    NSString *callbackId = command.callbackId;
    [[FCMModernCore sharedCore] subscribeToTopic:topic completion:^(NSError *_Nullable error) {
        if (error == nil) {
            [self sendOK:callbackId value:topic];
        } else {
            [self sendError:callbackId message:error.localizedDescription];
        }
    }];
}

- (void)unsubscribeFromTopic:(CDVInvokedUrlCommand *)command {
    NSString *topic = [self topicFromCommand:command];
    if (topic == nil) {
        [self sendError:command.callbackId message:@"unsubscribeFromTopic requires a non-empty topic string"];
        return;
    }
    NSString *callbackId = command.callbackId;
    [[FCMModernCore sharedCore] unsubscribeFromTopic:topic completion:^(NSError *_Nullable error) {
        if (error == nil) {
            [self sendOK:callbackId value:topic];
        } else {
            [self sendError:callbackId message:error.localizedDescription];
        }
    }];
}

#pragma mark - notifications / presentation / auto-init

// App-scoped cancellation only.
- (void)clearAllNotifications:(CDVInvokedUrlCommand *)command {
    [[FCMModernCore sharedCore] clearAllNotifications];
    [self sendOK:command.callbackId value:nil];
}

// Notification channels are an Android concept: accepted as a no-op on iOS.
- (void)createNotificationChannel:(CDVInvokedUrlCommand *)command {
    [self sendOK:command.callbackId value:nil];
}

- (void)setAutoInitEnabled:(CDVInvokedUrlCommand *)command {
    NSNumber *enabled = [command.arguments count] > 0 ? command.arguments[0] : nil;
    if (![enabled isKindOfClass:[NSNumber class]]) {
        [self sendError:command.callbackId message:@"setAutoInitEnabled requires a boolean argument"];
        return;
    }
    [[FCMModernCore sharedCore] setAutoInitEnabled:enabled.boolValue];
    [self sendOKBool:command.callbackId value:enabled.boolValue];
}

- (void)isAutoInitEnabled:(CDVInvokedUrlCommand *)command {
    [self sendOKBool:command.callbackId value:[FCMModernCore sharedCore].isAutoInitEnabled];
}

- (void)setForegroundPresentation:(CDVInvokedUrlCommand *)command {
    NSDictionary *options = [command.arguments count] > 0 ? command.arguments[0] : nil;
    if (![options isKindOfClass:[NSDictionary class]]) {
        [self sendError:command.callbackId message:@"setForegroundPresentation requires an {alert, sound, badge} object"];
        return;
    }
    BOOL alert = [options[@"alert"] isKindOfClass:[NSNumber class]] ? [options[@"alert"] boolValue] : YES;
    BOOL sound = [options[@"sound"] isKindOfClass:[NSNumber class]] ? [options[@"sound"] boolValue] : YES;
    BOOL badge = [options[@"badge"] isKindOfClass:[NSNumber class]] ? [options[@"badge"] boolValue] : YES;
    UNNotificationPresentationOptions presentation = UNNotificationPresentationOptionNone;
    if (alert) presentation |= UNNotificationPresentationOptionAlert;
    if (sound) presentation |= UNNotificationPresentationOptionSound;
    if (badge) presentation |= UNNotificationPresentationOptionBadge;
    [[FCMModernCore sharedCore] setForegroundPresentationOptions:presentation];
    [self sendOK:command.callbackId value:nil];
}

#pragma mark - JS event bridge

- (void)startJsEventBridge:(CDVInvokedUrlCommand *)command {
    // Replacing a live bridge detaches the old sink without losing queued events.
    if (_bridgeSink != nil) {
        [[FCMEventBus sharedBus] detachSink:_bridgeSink];
        _bridgeSink = nil;
    }
    _bridgeCallbackId = [command.callbackId copy];

    __weak FCMPlugin *weakSelf = self;
    _bridgeSink = ^(NSString *eventKind, id eventPayload) {
        FCMPlugin *plugin = weakSelf;
        if (plugin == nil || plugin->_bridgeCallbackId == nil) {
            return;
        }
        NSError *error = nil;
        NSString *json = nil;
        if ([eventKind isEqualToString:@"notification"]) {
            json = [FCMPayload notificationEventJSON:eventPayload error:&error];
        } else if ([eventKind isEqualToString:@"tokenRefresh"]) {
            json = [FCMPayload tokenRefreshEventJSON:eventPayload error:&error];
        } else {
            return;
        }
        if (json == nil) {
            // Bridge failure must produce an error, never a callback that hangs
            // forever: terminate the keep-alive callback with an ERROR result.
            NSString *message = [NSString stringWithFormat:@"FCM event bridge failed (%@ event)", eventKind];
            [plugin sendError:plugin->_bridgeCallbackId message:message];
            [[FCMEventBus sharedBus] detachSink:plugin->_bridgeSink];
            plugin->_bridgeSink = nil;
            plugin->_bridgeCallbackId = nil;
            return;
        }
        CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:json];
        [result setKeepCallbackAsBool:YES];  // ["notification", payload] / ["tokenRefresh", token]
        [plugin.commandDelegate sendPluginResult:result callbackId:plugin->_bridgeCallbackId];
    };

    [[FCMEventBus sharedBus] attachSink:_bridgeSink];  // replays buffered events, then live
    [self sendOK:command.callbackId value:nil];
}

- (void)stopJsEventBridge:(CDVInvokedUrlCommand *)command {
    [[FCMEventBus sharedBus] detachSink:_bridgeSink];
    _bridgeSink = nil;
    _bridgeCallbackId = nil;
    [self sendOK:command.callbackId value:nil];
}

- (void)replayBufferedEvents:(CDVInvokedUrlCommand *)command {
    if (_bridgeSink == nil || _bridgeCallbackId == nil) {
        [self sendError:command.callbackId message:@"replayBufferedEvents requires a started event bridge (startJsEventBridge)"];
        return;
    }
    [[FCMEventBus sharedBus] replayBufferedEventsToSink:_bridgeSink];
    [self sendOK:command.callbackId value:nil];
}

@end
