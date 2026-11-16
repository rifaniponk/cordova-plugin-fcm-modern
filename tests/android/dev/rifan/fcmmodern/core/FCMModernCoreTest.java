package dev.rifan.fcmmodern.core;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * JVM behavior harness for FCMModernCore and FCMPayload, driven by
 * scripts/native-jvm.mjs against tests/android/stubs. A JVM unit check only;
 * not a Gradle build and not an on-device push-delivery test.
 */
public final class FCMModernCoreTest {
    private static int passed = 0;

    private static void check(boolean condition, String name) {
        if (!condition) {
            throw new AssertionError("FAILED: " + name);
        }
        passed++;
        System.out.println("ok - " + name);
    }

    private static final class FakeGateway implements FCMModernCore.NativeGateway {
        final List<String> calls = new ArrayList<>();
        boolean permissionGranted = true;
        private FCMModernCore.TokenCallback pendingToken = null;
        private String tokenResult = null;
        private String tokenError = null;
        private boolean tokenResolved = false;

        void completeToken() {
            FCMModernCore.TokenCallback callback = pendingToken;
            pendingToken = null;
            if (callback == null) {
                throw new AssertionError("FAILED: no token operation in flight");
            }
            if (tokenError != null) {
                callback.onError(tokenError);
            } else {
                tokenResolved = true;
                callback.onResult(tokenResult);
            }
        }

        @Override
        public void requestToken(FCMModernCore.TokenCallback callback) {
            calls.add("requestToken");
            pendingToken = callback;
        }

        @Override
        public void deleteToken(FCMModernCore.TokenCallback callback) {
            calls.add("deleteToken");
            callback.onResult(null);
        }

        @Override
        public void subscribeTopic(String topic, FCMModernCore.OperationCallback callback) {
            calls.add("subscribe:" + topic);
            if (tokenResolved) {
                callback.onSuccess();
            } else {
                callback.onError("token not available");
            }
        }

        @Override
        public void unsubscribeTopic(String topic, FCMModernCore.OperationCallback callback) {
            calls.add("unsubscribe:" + topic);
            if (tokenResolved) {
                callback.onSuccess();
            } else {
                callback.onError("token not available");
            }
        }

        @Override
        public void createChannel(String channelId, String channelName) {
            calls.add("channel:" + channelId + "/" + channelName);
        }

        @Override
        public void cancelNotifications() {
            calls.add("cancel");
        }

        @Override
        public void requestPermission(FCMModernCore.PermissionCallback callback) {
            calls.add("permission");
            if (permissionGranted) {
                callback.onGranted();
            } else {
                callback.onDenied("user declined the prompt");
            }
        }
    }

    public static void main(String[] args) throws Exception {
        topicResolvesOnlyAfterTokenCompletes();
        topicResolvesWithUsefulErrorWhenTokenFails();
        tokenWaitersFanOutFromOneSdkCall();
        deleteTokenClearsCacheAndRepeatsAlias();
        permissionDenialProducesUsefulError();
        channelAndCancellationAreAppScoped();
        payloadRulesMirrorTheJsContract();
        idlessMessagesNeverCollapse();
        startupTapIsTheFirstTap();

        System.out.println("[native-jvm] ok — " + passed + " core checks passed");
    }

    private static void topicResolvesOnlyAfterTokenCompletes() {
        FakeGateway gateway = new FakeGateway();
        gateway.tokenResult = "tok-1";
        FCMModernCore core = new FCMModernCore(new FcmEventBus(), gateway);
        List<String> order = new ArrayList<>();
        core.subscribeTopic("news", new FCMModernCore.OperationCallback() {
            @Override
            public void onSuccess() {
                order.add("subscribed");
            }

            @Override
            public void onError(String message) {
                order.add("error:" + message);
            }
        });
        check(order.isEmpty(), "topic waits while token is in flight");
        check(gateway.calls.equals(List.of("requestToken")), "subscribe not sent before token completes");
        gateway.completeToken();
        check(gateway.calls.equals(List.of("requestToken", "subscribe:news")), "subscribe runs after token result");
        check(order.equals(List.of("subscribed")), "topic resolves after SDK token operation");
    }

    private static void topicResolvesWithUsefulErrorWhenTokenFails() {
        FakeGateway gateway = new FakeGateway();
        gateway.tokenError = "Firebase unavailable";
        FCMModernCore core = newCore(gateway);
        List<String> errors = new ArrayList<>();
        core.subscribeTopic("news", new FCMModernCore.OperationCallback() {
            @Override
            public void onSuccess() {
                throw new AssertionError("FAILED: topic succeeded after token failure");
            }

            @Override
            public void onError(String message) {
                errors.add(message);
            }
        });
        check(errors.isEmpty(), "topic waits while token is in flight (failure case)");
        gateway.completeToken();
        check(errors.size() == 1 && errors.get(0).startsWith("FCM topic subscribe failed for \"news\""),
            "topic resolves with useful error after token failure");
    }

    private static void tokenWaitersFanOutFromOneSdkCall() {
        FakeGateway gateway = new FakeGateway();
        gateway.tokenResult = "tok-2";
        FCMModernCore core = newCore(gateway);
        List<String> results = new ArrayList<>();
        FCMModernCore.TokenCallback collect = new FCMModernCore.TokenCallback() {
            @Override
            public void onResult(String token) {
                results.add(token);
            }

            @Override
            public void onError(String message) {
                results.add("error:" + message);
            }
        };
        core.getToken(collect);
        core.getToken(collect);
        gateway.completeToken();
        check(gateway.calls.equals(List.of("requestToken")), "one SDK token call for concurrent waiters");
        check(results.equals(List.of("tok-2", "tok-2")), "all waiters receive the token");
    }

    private static void deleteTokenClearsCacheAndRepeatsAlias() {
        FakeGateway gateway = new FakeGateway();
        gateway.tokenResult = "tok-3";
        FCMModernCore core = newCore(gateway);
        core.getToken(noop());
        gateway.completeToken();
        core.deleteToken(noop());
        core.getToken(noop());
        gateway.completeToken();
        check(gateway.calls.equals(List.of("requestToken", "deleteToken", "requestToken")),
            "deleteToken alias clears the cached token for re-fetch");
    }

    private static void permissionDenialProducesUsefulError() {
        FakeGateway gateway = new FakeGateway();
        gateway.permissionGranted = false;
        FCMModernCore core = newCore(gateway);
        List<String> denied = new ArrayList<>();
        core.requestPermission(new FCMModernCore.PermissionCallback() {
            @Override
            public void onGranted() {
                throw new AssertionError("FAILED: granted after denial");
            }

            @Override
            public void onDenied(String message) {
                denied.add(message);
            }
        });
        check(denied.size() == 1 && denied.get(0).startsWith("Notification permission denied:"),
            "denied permission produces a useful error");
    }

    private static void channelAndCancellationAreAppScoped() {
        FakeGateway gateway = new FakeGateway();
        FCMModernCore core = newCore(gateway);
        core.createNotificationChannel();
        core.cancelAllNotifications();
        check(gateway.calls.get(0).equals("channel:fcmmodern_default/FCMModern Push Notifications"),
            "channel is app-scoped with a fixed id");
        check(gateway.calls.get(1).equals("cancel"), "cancellation goes through the app gateway");
    }

    private static void payloadRulesMirrorTheJsContract() {
        Map<String, String> extras = new HashMap<>();
        extras.put("title", "spoofed title");
        extras.put("__proto__", "boom");
        extras.put("constructor", "boom");
        extras.put("custom", "user-value");
        extras.put("plain", "value");
        JSONObject payload = FCMPayload.normalize(extras, "m-1", false, "trusted title", null, "body", 3);

        check(payload.optString("title").equals("trusted title"), "trusted metadata wins over sender data");
        check(((JSONObject) payload.get("custom")).optString("title").equals("spoofed title"),
            "colliding user key relocated to custom");
        check(((JSONObject) payload.get("_fcm")).get("collisions") instanceof java.util.List,
            "collisions recorded in _fcm");
        check(((JSONObject) payload.get("_fcm")).get("dropped") instanceof java.util.List,
            "prototype-sensitive keys dropped and recorded");
        check(!payload.has("__proto__") && !payload.has("constructor"), "prototype-sensitive keys never copied");
        check(payload.optString("messageId").equals("m-1"), "canonical message id preserved");
        check(payload.optString("plain").equals("value"), "plain sender data preserved");
        check(payload.optString("wasTapped").equals("false"), "wasTapped is trusted metadata");
    }

    private static void idlessMessagesNeverCollapse() {
        FakeGateway gateway = new FakeGateway();
        FCMModernCore core = newCore(gateway);
        Map<String, String> first = new HashMap<>();
        Map<String, String> second = new HashMap<>();
        JSONObject a = core.onNativeEvent(first, null, false, null, null, "first", null);
        JSONObject b = core.onNativeEvent(second, null, false, null, null, "second", null);
        check(a != b, "id-less receipts stay distinct");

        Map<String, String> withId = new HashMap<>();
        List<JSONObject> replay = new ArrayList<>();
        FCMModernCore fresh = new FCMModernCore(replayBus(replay), gateway);
        fresh.onNativeEvent(withId, "m-x", false, null, null, "first", null);
        fresh.onNativeEvent(withId, "m-x", false, null, null, "again", null);
        check(replay.size() == 1, "same id dedups within one receipt space");
    }

    private static void startupTapIsTheFirstTap() {
        FcmEventBus bus = new FcmEventBus();
        FCMModernCore core = new FCMModernCore(bus, new FakeGateway());
        Map<String, String> tapExtras = new HashMap<>();
        JSONObject first = core.onNativeEvent(tapExtras, "tap-1", true, null, null, "first tap", null);
        core.onNativeEvent(tapExtras, "tap-1", true, null, null, "second tap", null);
        check(core.getStartupTap() == first, "getInitialPushPayload returns only the startup tap");
        check(core.getStartupTap() == first, "startup tap stable across reads");
    }

    private static FcmEventBus replayBus(List<JSONObject> replay) {
        FcmEventBus bus = new FcmEventBus();
        bus.attachNotificationSink(replay::add);
        return bus;
    }

    private static FCMModernCore newCore(FakeGateway gateway) {
        return new FCMModernCore(new FcmEventBus(), gateway);
    }

    private static FCMModernCore.TokenCallback noop() {
        return new FCMModernCore.TokenCallback() {
            @Override
            public void onResult(String token) {}

            @Override
            public void onError(String message) {}
        };
    }

    private FCMModernCoreTest() {}
}
