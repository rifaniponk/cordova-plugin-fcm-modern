package dev.rifan.fcmmodern.core;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * JVM behavior harness for FcmEventBus, driven by scripts/native-jvm.mjs.
 * Compiles and runs against tests/android/stubs on Linux. This is a JVM unit
 * check only; it is not a Gradle build or an on-device push-delivery test.
 */
public final class FcmEventBusTest {
    private static int passed = 0;

    private static void check(boolean condition, String name) {
        if (!condition) {
            throw new AssertionError("FAILED: " + name);
        }
        passed++;
        System.out.println("ok - " + name);
    }

    public static void main(String[] args) {
        receiptAndTapForSameIdAreDistinct();
        missingIdsDoNotCollapse();
        queueIsBoundedAndOldestDropped();
        replayIsChronologicalReceiptsThenTaps();
        lateTokenSinkSeesNewestTokenOnce();
        sinkErrorsDoNotBreakOtherSubscribers();
        detachedSinkStopsReceiving();
        startupTapIsStableAcrossReads();

        System.out.println("[native-jvm] ok — " + passed + " checks passed");
    }

    private static void receiptAndTapForSameIdAreDistinct() {
        FcmEventBus bus = new FcmEventBus();
        JSONObject receipt = new JSONObject("receipt");
        JSONObject tap = new JSONObject("tap");
        check(bus.enqueueNotification(FcmEventBus.Space.RECEIPT, receipt, "id-A"), "first receipt accepted");
        check(!bus.enqueueNotification(FcmEventBus.Space.RECEIPT, receipt, "id-A"), "duplicate receipt dropped");
        check(bus.enqueueNotification(FcmEventBus.Space.TAP, tap, "id-A"), "tap of same id is a distinct event");

        List<JSONObject> replay = new ArrayList<>();
        bus.attachNotificationSink(replay::add);
        check(replay.size() == 2 && replay.get(0) == receipt && replay.get(1) == tap,
            "replay carries receipt and tap as two events");
    }

    private static void missingIdsDoNotCollapse() {
        FcmEventBus bus = new FcmEventBus();
        JSONObject first = new JSONObject("a");
        JSONObject second = new JSONObject("b");
        String key1 = bus.nextFallbackId();
        String key2 = bus.nextFallbackId();
        check(!key1.equals(key2), "fallback ids are unique");
        check(bus.enqueueNotification(FcmEventBus.Space.RECEIPT, first, key1), "first id-less event enqueued");
        check(bus.enqueueNotification(FcmEventBus.Space.RECEIPT, second, key2), "second id-less event not collapsed");
    }

    private static void queueIsBoundedAndOldestDropped() {
        FcmEventBus bus = new FcmEventBus();
        List<JSONObject> all = new ArrayList<>();
        for (int i = 0; i < 55; i++) {
            JSONObject payload = new JSONObject("e" + i);
            all.add(payload);
            check(bus.enqueueNotification(FcmEventBus.Space.RECEIPT, payload, "id-" + i), "enqueue " + i) ;
        }
        List<JSONObject> replay = new ArrayList<>();
        bus.attachNotificationSink(replay::add);
        check(replay.size() == 50, "queue bounded at 50 events");
        check(replay.get(0) == all.get(5), "oldest events dropped on overflow");
        check(replay.get(49) == all.get(54), "newest event retained on overflow");
    }

    private static void replayIsChronologicalReceiptsThenTaps() {
        FcmEventBus bus = new FcmEventBus();
        JSONObject t1 = new JSONObject("tap1");
        JSONObject r1 = new JSONObject("rec1");
        JSONObject t2 = new JSONObject("tap2");
        bus.enqueueNotification(FcmEventBus.Space.TAP, t1, "t1");
        bus.enqueueNotification(FcmEventBus.Space.RECEIPT, r1, "r1");
        bus.enqueueNotification(FcmEventBus.Space.TAP, t2, "t2");

        List<JSONObject> replay = new ArrayList<>();
        bus.attachNotificationSink(replay::add);
        check(replay.size() == 3, "all queued events replayed");
        check(replay.get(0).label().equals("tap1"), "oldest event replays first");
        check(replay.get(1).label().equals("rec1"), "receipt replays in enqueue order");
        check(replay.get(2).label().equals("tap2"), "newest tap replays last");
    }

    private static void lateTokenSinkSeesNewestTokenOnce() {
        FcmEventBus bus = new FcmEventBus();
        bus.publishToken("old-token");
        bus.publishToken("new-token");

        List<String> seen = new ArrayList<>();
        bus.attachTokenSink(seen::add);
        check(seen.size() == 1 && seen.get(0).equals("new-token"), "late token sink receives newest token once");

        bus.publishToken("newer-token");
        check(seen.size() == 2 && seen.get(1).equals("newer-token"), "attached sink receives later tokens");
    }

    private static void sinkErrorsDoNotBreakOtherSubscribers() {
        FcmEventBus bus = new FcmEventBus();
        List<String> tokens = new ArrayList<>();
        bus.attachTokenSink(token -> {
            throw new IllegalStateException("simulated broken listener");
        });
        bus.attachTokenSink(tokens::add);
        bus.publishToken("tok");
        check(tokens.size() == 1, "listener error does not break other subscribers");

        List<JSONObject> payloads = new ArrayList<>();
        bus.attachNotificationSink(payload -> {
            throw new IllegalStateException("simulated broken listener");
        });
        bus.attachNotificationSink(payloads::add);
        JSONObject payload = new JSONObject("p");
        check(bus.enqueueNotification(FcmEventBus.Space.RECEIPT, payload, "id-p"), "notification enqueue succeeds");
        check(payloads.size() == 1 && payloads.get(0) == payload, "healthy notification sink still receives event");
    }

    private static void detachedSinkStopsReceiving() {
        FcmEventBus bus = new FcmEventBus();
        List<String> tokens = new ArrayList<>();
        Consumer<String> sink = tokens::add;
        bus.attachTokenSink(sink);
        bus.detachTokenSink(sink);
        bus.publishToken("after-detach");
        check(tokens.isEmpty(), "detached token sink receives nothing");

        List<JSONObject> payloads = new ArrayList<>();
        Consumer<JSONObject> nsink = payloads::add;
        bus.attachNotificationSink(nsink);
        bus.detachNotificationSink(nsink);
        bus.enqueueNotification(FcmEventBus.Space.RECEIPT, new JSONObject("late"), "id-late");
        check(payloads.isEmpty(), "detached notification sink receives nothing");
    }

    private static void startupTapIsStableAcrossReads() {
        FcmEventBus bus = new FcmEventBus();
        JSONObject firstTap = new JSONObject("first");
        JSONObject secondTap = new JSONObject("second");
        bus.setStartupTap(firstTap);
        bus.setStartupTap(secondTap);
        check(bus.getStartupTap() == firstTap, "startup tap is set once and stable");
        check(bus.getStartupTap() == firstTap, "startup tap stable across reads");
        bus.enqueueNotification(FcmEventBus.Space.TAP, secondTap, "id-2");
        check(bus.getStartupTap() == firstTap, "startup tap ignores later taps");
    }

    private FcmEventBusTest() {}
}
