package dev.rifan.fcmmodern.service;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

import dev.rifan.fcmmodern.core.FCMModernCore;

import java.util.HashMap;
import java.util.Map;

/**
 * Internal tap target for notifications this plugin presents. Not exported:
 * only the immutable PendingIntent built by FCMModernMessagingService can
 * reach it, so third-party apps cannot forge tap events with arbitrary
 * extras. The tap becomes a distinct TAP event and the startup payload.
 */
public class FCMModernTapActivity extends Activity {
    public static final String EXTRA_MESSAGE_ID = "fcmmodern_message_id";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = getIntent();
        Bundle extras = intent == null ? null : intent.getExtras();
        Map<String, String> data = new HashMap<>();
        String messageId = null;
        if (extras != null) {
            for (String key : extras.keySet()) {
                Object value = extras.get(key);
                if (value instanceof String && !EXTRA_MESSAGE_ID.equals(key)) {
                    data.put(key, (String) value);
                }
            }
            messageId = extras.getString(EXTRA_MESSAGE_ID);
        }
        FCMModernCore.enqueue(FCMModernHolder.bus(), data, messageId, true, null, null, null, null);
        finish();
    }
}
