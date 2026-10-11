package com.bizh.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
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

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SplashOverlayView splashOverlay;

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

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
