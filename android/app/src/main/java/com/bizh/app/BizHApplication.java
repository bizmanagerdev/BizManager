package com.bizh.app;

import android.app.Application;
import io.sentry.IConnectionStatusProvider;
import io.sentry.android.core.SentryAndroid;

/**
 * Starts the crash reports (Sentry, APK 1.2) before anything else of the app
 * runs. Its settings — the project's address, no screenshots, no personal
 * details — are in AndroidManifest.xml; this adds one thing the manifest can't.
 *
 * Sentry sends a saved report only when Android calls the network "connected
 * to the internet". On a filtered network (NetFree-like) Android's own internet
 * check is blocked, the signal shows "!" and the network is never called
 * connected, although everything else works — found on the test phone,
 * 2026-10-11: the test crash was kept and never sent. So the app doesn't let
 * Android's check decide: it just tries, and a report that can't go stays saved
 * for the next open.
 */
public class BizHApplication extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        SentryAndroid.init(this, options -> options.setConnectionStatusProvider(new AlwaysTryToSend()));
    }

    /** "Don't know": Sentry then sends instead of waiting for Android's say-so. */
    private static final class AlwaysTryToSend implements IConnectionStatusProvider {
        @Override
        public ConnectionStatus getConnectionStatus() {
            return ConnectionStatus.UNKNOWN;
        }

        @Override
        public String getConnectionType() {
            return null;
        }

        @Override
        public boolean addConnectionStatusObserver(IConnectionStatusObserver observer) {
            return false;
        }

        @Override
        public void removeConnectionStatusObserver(IConnectionStatusObserver observer) {}

        @Override
        public void close() {}
    }
}
