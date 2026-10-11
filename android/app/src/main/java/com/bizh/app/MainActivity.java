package com.bizh.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    /** The site the app shows. Links to it open inside the app (see the manifest's App Links filter). */
    static final String SITE_HOST = "www.biz-h.com";
    static final String SITE_ORIGIN = "https://" + SITE_HOST;

    /**
     * The opening screen never stays longer than this, even if the website never
     * says it's ready (an old website version, an error page).
     */
    private static final long SPLASH_MAX_MS = 5000;
    /**
     * Until the website says "the dashboard is drawn" (BizHNative.splashReady), the
     * page finishing its load plus this much is taken as ready: the page's own
     * scripts still need a moment to draw it after the load.
     */
    private static final long SPLASH_AFTER_LOAD_MS = 700;

    /**
     * With the app lock on, it locks again after being away this long (and on
     * every fresh start). Short trips out (the camera, a file picker, the share
     * sheet, a quick look at WhatsApp) don't ask again.
     */
    private static final long LOCK_AFTER_MS = 5 * 60 * 1000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SplashOverlayView splashOverlay;

    private BiometricPrompt biometricPrompt;
    @Nullable
    private BiometricPrompt.AuthenticationCallback authCallback;
    private LockOverlayView lockOverlay;
    private boolean locked;
    /** A lock prompt is on screen. */
    private boolean unlocking;
    /** When the app last went to the background (elapsedRealtime), 0 while it's on screen. */
    private long backgroundSince;
    private final OnBackPressedCallback lockBack = new OnBackPressedCallback(false) {
        @Override
        public void handleOnBackPressed() {
            moveTaskToBack(true);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Android's own opening screen (launch theme: light blue + the big chevron).
        // Must be installed before super.onCreate.
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        // The app's own helper for the website (saving files, self-update, calls,
        // "the dashboard is drawn"). Plugins must be registered before super.onCreate.
        registerPlugin(BizHNativePlugin.class);

        super.onCreate(savedInstanceState);

        showSplashOverlay(splashScreen);
        setUpDownloads();
        setUpFingerprintPrompt();
        if (Fingerprint.appLockOn(this)) showLock();
        AppShortcuts.setDefaultsOnce(this);
    }

    // ---------------------------------------------------------------- opening screen

    private void showSplashOverlay(SplashScreen splashScreen) {
        splashOverlay = new SplashOverlayView(this);
        // On the decor view, so it covers the whole screen like Android's own part
        // and its big chevron lands on exactly the same spot.
        ((ViewGroup) getWindow().getDecorView()).addView(
            splashOverlay,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        // Our layer is in the window before its first frame, so when Android hands
        // over (the exit listener runs once that frame is ready) it's already drawn.
        // Swap with no animation: both show the same colour and the same chevron,
        // so nothing moves. (No setKeepOnScreenCondition here: while it holds,
        // Android skips drawing the window, so it can't wait for our own draw.)
        splashScreen.setOnExitAnimationListener(provider -> {
            provider.remove();
            // The splash library leaves the window laid out edge to edge (behind the
            // status and navigation bars). Put it back: the page sits between the
            // bars, and the keyboard shrinks it (adjustResize) instead of covering
            // the bottom of a dialog. Measured on Android 15: without this the web
            // view stayed 2400px tall with the keyboard open.
            fitWindowBetweenBars();
            if (splashOverlay != null) splashOverlay.startChevrons();
        });

        if (bridge != null) {
            bridge.addWebViewListener(
                new WebViewListener() {
                    @Override
                    public void onPageLoaded(WebView webView) {
                        handler.postDelayed(MainActivity.this::hideSplash, SPLASH_AFTER_LOAD_MS);
                    }

                    @Override
                    public void onReceivedError(WebView webView) {
                        hideSplash();
                    }
                }
            );
        }
        handler.postDelayed(this::hideSplash, SPLASH_MAX_MS);
    }

    /**
     * Lay the page out between the status bar and the navigation bar again. The
     * splash library sets both the new "decor doesn't fit" mode and the old
     * LAYOUT_FULLSCREEN / LAYOUT_STABLE flags; the second keeps the page under the
     * status bar (the dashboard's top bar was hidden behind it on Android 15), so
     * both are undone. The light-icon bits of the same flags are kept.
     */
    @SuppressWarnings("deprecation")
    private void fitWindowBetweenBars() {
        View decor = getWindow().getDecorView();
        int layoutFlags =
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        decor.setSystemUiVisibility(decor.getSystemUiVisibility() & ~layoutFlags);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    }

    /** Fade the opening screen out. Called by the website (BizHNative.splashReady) or the fallbacks. */
    void hideSplash() {
        handler.post(() -> {
            if (splashOverlay != null) {
                splashOverlay.dismiss();
                splashOverlay = null;
            }
        });
    }

    // ---------------------------------------------------------------- links

    /**
     * Runs for the launch intent too: BridgeActivity.load() hands it here once the
     * bridge exists. A biz-h.com link (from WhatsApp, an email, a notification, or
     * "answer" on an incoming call) opens on its own page instead of the dashboard.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openSiteLink(intent);
    }

    private void openSiteLink(Intent intent) {
        if (intent == null || bridge == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri data = intent.getData();
        if (data == null || !"https".equals(data.getScheme())) return;
        String host = data.getHost();
        if (!SITE_HOST.equals(host) && !"biz-h.com".equals(host)) return;

        String path = data.getEncodedPath() == null || data.getEncodedPath().isEmpty() ? "/" : data.getEncodedPath();
        StringBuilder url = new StringBuilder(SITE_ORIGIN).append(path);
        if (data.getEncodedQuery() != null) url.append('?').append(data.getEncodedQuery());
        if (data.getEncodedFragment() != null) url.append('#').append(data.getEncodedFragment());

        WebView webView = bridge.getWebView();
        webView.post(() -> webView.loadUrl(url.toString()));
    }

    // ---------------------------------------------------------------- downloads

    /**
     * Download buttons did nothing in the app: a WebView has no download handling
     * of its own. A file from the server goes to Downloads through Android's
     * download manager (with the login cookie, so protected files work). A file the
     * page made itself (blob:/data:) is read in the page and saved through
     * BizHNative.saveDownload; the website's own download helper does that directly,
     * with the real file name, and this is the fallback for anything it misses.
     */
    private void setUpDownloads() {
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            if (url.startsWith("http://") || url.startsWith("https://")) {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    String cookies = CookieManager.getInstance().getCookie(url);
                    if (cookies != null) request.addRequestHeader("Cookie", cookies);
                    request.addRequestHeader("User-Agent", userAgent);
                    request.setTitle(name);
                    if (mimeType != null) request.setMimeType(mimeType);
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                    DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    manager.enqueue(request);
                    Toast.makeText(this, "מוריד: " + name, Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "ההורדה לא הצליחה", Toast.LENGTH_SHORT).show();
                }
            } else if (url.startsWith("blob:") || url.startsWith("data:")) {
                String js =
                    "(async function(){try{" +
                    "var r=await fetch(" + JSONObject.quote(url) + ");var b=await r.blob();" +
                    "var fr=new FileReader();fr.onload=function(){var d=String(fr.result);" +
                    "window.Capacitor.Plugins.BizHNative.saveDownload({data:d.slice(d.indexOf(',')+1)," +
                    "mimeType:b.type||" + JSONObject.quote(mimeType == null ? "" : mimeType) + "," +
                    "filename:" + JSONObject.quote(name) + ",open:true});};fr.readAsDataURL(b);" +
                    "}catch(e){console.error('BizH download failed',e);}})();";
                webView.evaluateJavascript(js, null);
            }
        });
    }

    // ---------------------------------------------------------------- staying signed in

    /**
     * The web view writes its cookies to disk only every so often. If Android closes
     * the app before a renewed login cookie is written, the next open signs in with
     * the old one and is logged out (cards "why do i get logged out often on the
     * phone" and "החיבור פג"). Write them the moment the app goes to the background.
     */
    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    // ---------------------------------------------------------------- fingerprint and the app lock

    /**
     * One prompt for the whole app, made here in onCreate as androidx.biometric
     * asks; each request (the lock, fingerprint sign-in) hands it its own callback.
     */
    private void setUpFingerprintPrompt() {
        biometricPrompt = new BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    BiometricPrompt.AuthenticationCallback callback = takeAuthCallback();
                    if (callback != null) callback.onAuthenticationSucceeded(result);
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    BiometricPrompt.AuthenticationCallback callback = takeAuthCallback();
                    if (callback != null) callback.onAuthenticationError(errorCode, errString);
                }
            }
        );
        // While locked, Back leaves the app instead of reaching the page behind the lock.
        getOnBackPressedDispatcher().addCallback(this, lockBack);
    }

    private BiometricPrompt.AuthenticationCallback takeAuthCallback() {
        BiometricPrompt.AuthenticationCallback callback = authCallback;
        authCallback = null;
        return callback;
    }

    /**
     * Show the prompt. Fails at once with ERROR_CANCELED if another one is
     * already up (the lock and a sign-in never need two at a time).
     */
    void authenticate(
        BiometricPrompt.PromptInfo info,
        @Nullable BiometricPrompt.CryptoObject crypto,
        BiometricPrompt.AuthenticationCallback callback
    ) {
        runOnUiThread(() -> {
            if (authCallback != null || biometricPrompt == null || isFinishing()) {
                callback.onAuthenticationError(BiometricPrompt.ERROR_CANCELED, "busy");
                return;
            }
            authCallback = callback;
            try {
                if (crypto != null) biometricPrompt.authenticate(info, crypto);
                else biometricPrompt.authenticate(info);
            } catch (Exception e) {
                authCallback = null;
                callback.onAuthenticationError(BiometricPrompt.ERROR_HW_UNAVAILABLE, String.valueOf(e.getMessage()));
            }
        });
    }

    /** Cover the app until it's unlocked. */
    private void showLock() {
        locked = true;
        lockBack.setEnabled(true);
        if (lockOverlay != null) return;
        lockOverlay = new LockOverlayView(this, this::promptUnlock);
        ((ViewGroup) getWindow().getDecorView()).addView(
            lockOverlay,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
    }

    private void unlock() {
        locked = false;
        lockBack.setEnabled(false);
        if (lockOverlay != null) {
            ((ViewGroup) getWindow().getDecorView()).removeView(lockOverlay);
            lockOverlay = null;
        }
    }

    private void promptUnlock() {
        if (!locked || unlocking) return;
        // The phone's own lock was turned off since: nothing left to ask for, and
        // the app mustn't stay shut for good. The lock goes off with it.
        if (!Fingerprint.canLock(this)) {
            Fingerprint.setAppLock(this, false);
            unlock();
            return;
        }
        unlocking = true;
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("BizH נעולה")
            .setSubtitle("פתיחה בטביעת אצבע או בקוד הטלפון")
            .setAllowedAuthenticators(Fingerprint.LOCK_AUTHENTICATORS)
            .setConfirmationRequired(false)
            .build();
        authenticate(
            info,
            null,
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    unlocking = false;
                    unlock();
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    unlocking = false;
                    if (errorCode == BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL) {
                        Fingerprint.setAppLock(MainActivity.this, false);
                        unlock();
                    }
                    // Otherwise the lock stays, with its "פתיחה" button to try again.
                }
            }
        );
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!locked && Fingerprint.appLockOn(this) && backgroundSince > 0 &&
            SystemClock.elapsedRealtime() - backgroundSince >= LOCK_AFTER_MS) {
            showLock();
        }
        backgroundSince = 0;
        if (locked) promptUnlock();
    }

    @Override
    public void onStop() {
        super.onStop();
        // Not while a prompt is up: the phone's PIN screen is an activity of its own.
        if (!unlocking) backgroundSince = SystemClock.elapsedRealtime();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
