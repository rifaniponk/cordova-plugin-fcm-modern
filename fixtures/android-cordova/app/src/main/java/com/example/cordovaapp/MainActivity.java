package com.example.cordovaapp;

import android.os.Bundle;

import org.apache.cordova.Config;
import org.apache.cordova.CordovaActivity;

/**
 * Cordova consumer app entry point, following the cordova-android activity
 * template. The FCMModern Cordova adapter is not referenced here on purpose:
 * a real Cordova app discovers it through the config.xml <feature>
 * declaration in app/src/main/res/xml/config.xml, so the adapter must compile
 * as part of this app's merged source set.
 */
public class MainActivity extends CordovaActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        super.init();
        super.loadUrl(Config.getStartUrl());
    }
}
