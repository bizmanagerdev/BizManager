package com.bizh.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.util.Base64;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.crypto.Cipher;
import org.json.JSONObject;

/**
 * The app's own helper for the website: window.Capacitor.Plugins.BizHNative.
 *
 *   splashReady()                   the dashboard has drawn: fade the opening screen out
 *   printPage({name})               Android's print screen for the page on screen
 *   saveDownload({data, filename, mimeType, open})
 *                                   save a file the page made (base64) to Downloads, then open it
 *   installApk({url})               download a newer BizH APK and open Android's install screen
 *   canInstallApks()                {allowed}: has the user let BizH install updates?
 *   showIncomingCall({...})         ring like a phone call (the same screen a pushed call shows)
 *   endIncomingCall({callId})       stop ringing
 *   canUseFullScreenCalls() / openFullScreenCallSettings()
 *                                   Android 14+: may the ringing call cover the lock screen?
 *
 * From APK 1.2 (build 6):
 *   showTaskAlert({title, body, url, tag, taskId})
 *                                   a task alert with בוצע / לטיפול מחר / פתיחה
 *   fingerprintStatus()             {canSignIn, signInSaved, signInEmail, canLock, lockOn}
 *   saveFingerprintSignIn({email, password})
 *                                   keep the sign-in, sealed by the fingerprint (asks for it now)
 *   fingerprintSignIn()             {email, password} once the fingerprint matches
 *   deleteFingerprintSignIn()       forget it
 *   setAppLock({on})                the lock when the app opens (turning on asks once)
 *   setShortcuts({items})           the long-press shortcuts on the icon
 */
@CapacitorPlugin(name = "BizHNative")
public class BizHNativePlugin extends Plugin {

    @PluginMethod
    public void splashReady(PluginCall call) {
        Activity activity = getActivity();
        if (activity instanceof MainActivity) ((MainActivity) activity).hideSplash();
        call.resolve();
    }

    // ---------------------------------------------------------------- printing

    /**
     * Print the page on screen: Android's print screen (a printer, or Save as PDF),
     * with the page's own print styles. The website's window.print() lands here.
     * (@capgo/capacitor-printer's printWebView calls the web view off the main
     * thread and Android refuses it — found on the test phone, 2026-10-11.)
     */
    @PluginMethod
    public void printPage(PluginCall call) {
        String name = call.getString("name", "BizH");
        getActivity()
            .runOnUiThread(() -> {
                try {
                    PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    PrintDocumentAdapter adapter = getBridge().getWebView().createPrintDocumentAdapter(name);
                    printManager.print(name, adapter, new PrintAttributes.Builder().build());
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Could not open the print screen", e);
                }
            });
    }

    // ---------------------------------------------------------------- downloads

    @PluginMethod
    public void saveDownload(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("No file data");
            return;
        }
        String filename = safeName(call.getString("filename", "BizH-download"));
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (mimeType == null || mimeType.isEmpty()) mimeType = "application/octet-stream";
        boolean open = Boolean.TRUE.equals(call.getBoolean("open", true));
        final String mime = mimeType;

        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                Uri uri = writeToDownloads(filename, mime, bytes);
                Intent show = open ? openIntent(uri, mime, filename, bytes) : null;
                getActivity()
                    .runOnUiThread(() -> {
                        Toast.makeText(getContext(), "נשמר בהורדות: " + filename, Toast.LENGTH_SHORT).show();
                        if (show == null) return;
                        try {
                            getContext().startActivity(show);
                        } catch (ActivityNotFoundException e) {
                            // Nothing can take it: the file is still in Downloads.
                        }
                    });
                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                ret.put("filename", filename);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Could not save the file", e);
            }
        }).start();
    }

    private Uri writeToDownloads(String filename, String mimeType, byte[] bytes) throws Exception {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = context.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("No Downloads entry");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("No output stream");
                out.write(bytes);
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            return uri;
        }
        // Android 9 and older: the app's own Downloads folder (no storage permission
        // needed), handed out through the FileProvider for opening/sharing.
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = new File(context.getCacheDir(), "downloads");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File file = uniqueFile(dir, filename);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
    }

    /**
     * What to show once a file is saved: an app that opens it (a PDF viewer,
     * Sheets, Excel). If no app on the phone opens this type, the share sheet
     * instead (WhatsApp, Drive, email), rather than Android's "No apps can perform
     * this action" (seen on a phone with no spreadsheet app, 2026-10-11). The share
     * sheet gets a copy under the file's own name: shared from Downloads, it showed
     * the Downloads entry's number.
     */
    private Intent openIntent(Uri uri, String mimeType, String filename, byte[] bytes) throws Exception {
        Context context = getContext();
        Intent view = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, mimeType)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        if (view.resolveActivity(context.getPackageManager()) != null) {
            return Intent.createChooser(view, filename).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }

        File dir = new File(context.getCacheDir(), "shared");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File copy = new File(dir, filename);
        try (FileOutputStream out = new FileOutputStream(copy)) {
            out.write(bytes);
        }
        Uri shareUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", copy);
        Intent send = new Intent(Intent.ACTION_SEND)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_STREAM, shareUri)
            .putExtra(Intent.EXTRA_TITLE, filename)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        send.setClipData(ClipData.newRawUri(filename, shareUri));
        return Intent.createChooser(send, filename).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private static String safeName(String name) {
        String cleaned = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        return cleaned.isEmpty() ? "BizH-download" : cleaned;
    }

    private static File uniqueFile(File dir, String filename) {
        File file = new File(dir, filename);
        if (!file.exists()) return file;
        int dot = filename.lastIndexOf('.');
        String base = dot > 0 ? filename.substring(0, dot) : filename;
        String ext = dot > 0 ? filename.substring(dot) : "";
        for (int i = 1; i < 1000; i++) {
            File candidate = new File(dir, base + " (" + i + ")" + ext);
            if (!candidate.exists()) return candidate;
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    // ---------------------------------------------------------------- updates from inside the app

    /** Where a new APK may come from: the site itself, or its file storage. */
    private static boolean isAllowedApkHost(String host) {
        if (host == null) return false;
        return (
            host.equals("biz-h.com") ||
            host.endsWith(".biz-h.com") ||
            host.endsWith(".supabase.co") ||
            host.endsWith(".public.blob.vercel-storage.com")
        );
    }

    @PluginMethod
    public void canInstallApks(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", canInstall());
        call.resolve(ret);
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String url = call.getString("url");
        Uri parsed = url == null ? null : Uri.parse(url);
        if (parsed == null || !"https".equals(parsed.getScheme()) || !isAllowedApkHost(parsed.getHost())) {
            call.reject("Not an allowed update address");
            return;
        }
        if (!canInstall()) {
            // Android asks once: "allow BizH to install apps". Open that switch; the
            // website tells the user to come back and tap update again.
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            JSObject ret = new JSObject();
            ret.put("status", "needs-permission");
            call.resolve(ret);
            return;
        }

        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File apk = new File(dir, "BizH-update.apk");
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(60000);
                if (connection.getResponseCode() != 200) throw new IllegalStateException("HTTP " + connection.getResponseCode());
                try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(install);
                JSObject ret = new JSObject();
                ret.put("status", "installer-opened");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Could not download the update", e);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    // ---------------------------------------------------------------- calls

    @PluginMethod
    public void showIncomingCall(PluginCall call) {
        Map<String, String> data = new HashMap<>();
        for (String key : new String[] { "callId", "callerName", "callerNumber", "details", "url" }) {
            String value = call.getString(key);
            if (value != null) data.put(key, value);
        }
        IncomingCall.show(getContext(), data);
        call.resolve();
    }

    @PluginMethod
    public void endIncomingCall(PluginCall call) {
        IncomingCall.cancel(getContext(), call.getString("callId"));
        call.resolve();
    }

    @PluginMethod
    public void canUseFullScreenCalls(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            allowed = manager.canUseFullScreenIntent();
        }
        JSObject ret = new JSObject();
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    @PluginMethod
    public void openFullScreenCallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
        }
        call.resolve();
    }

    // ---------------------------------------------------------------- task alerts

    /**
     * Show a task alert with its buttons now, the same as a pushed one
     * ({title, body, url, tag, taskId}) — for alerts the website raises itself.
     */
    @PluginMethod
    public void showTaskAlert(PluginCall call) {
        Map<String, String> data = new HashMap<>();
        for (String key : new String[] { "title", "body", "url", "tag", "taskId" }) {
            String value = call.getString(key);
            if (value != null) data.put(key, value);
        }
        TaskAlert.show(getContext(), data);
        call.resolve();
    }

    // ---------------------------------------------------------------- fingerprint and the app lock

    /** {canSignIn, signInSaved, signInEmail, canLock, lockOn} — what the login page and settings show. */
    @PluginMethod
    public void fingerprintStatus(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();
        ret.put("canSignIn", Fingerprint.canSignIn(context));
        ret.put("signInSaved", Fingerprint.hasSignIn(context));
        ret.put("signInEmail", Fingerprint.signInEmail(context));
        ret.put("canLock", Fingerprint.canLock(context));
        ret.put("lockOn", Fingerprint.appLockOn(context));
        call.resolve(ret);
    }

    /**
     * Keep {email, password} for fingerprint sign-in. The fingerprint is asked for
     * now, to seal them; rejects with code "cancelled" if the person backs out.
     */
    @PluginMethod
    public void saveFingerprintSignIn(PluginCall call) {
        String email = call.getString("email");
        String password = call.getString("password");
        MainActivity activity = mainActivity();
        if (email == null || email.isEmpty() || password == null || password.isEmpty() || activity == null) {
            call.reject("Missing email or password", "invalid");
            return;
        }
        Cipher cipher;
        try {
            cipher = Fingerprint.encryptCipher();
        } catch (Exception e) {
            call.reject("No fingerprint on this phone", "unavailable", e);
            return;
        }
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("כניסה עם טביעת אצבע")
            .setSubtitle(email)
            .setDescription("הניחו את האצבע כדי להפעיל כניסה בטביעת אצבע בטלפון הזה")
            .setNegativeButtonText("ביטול")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setConfirmationRequired(false)
            .build();
        activity.authenticate(
            info,
            new BiometricPrompt.CryptoObject(cipher),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    try {
                        BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                        if (crypto == null || crypto.getCipher() == null) throw new IllegalStateException("No cipher");
                        String secret = new JSONObject().put("email", email).put("password", password).toString();
                        Fingerprint.saveSignIn(getContext(), email, crypto.getCipher(), secret);
                        JSObject ret = new JSObject();
                        ret.put("saved", true);
                        call.resolve(ret);
                    } catch (Exception e) {
                        Fingerprint.deleteSignIn(getContext());
                        call.reject("Could not save", "failed", e);
                    }
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    Fingerprint.deleteSignIn(getContext());
                    call.reject(errString.toString(), promptErrorCode(errorCode));
                }
            }
        );
    }

    /**
     * The saved {email, password}, after the fingerprint matches. Rejects with
     * "none" (nothing saved), "invalidated" (a fingerprint was added or removed
     * since: the saved sign-in is gone), "cancelled" (the person chose the
     * password), "lockout" (too many tries) or "error".
     */
    @PluginMethod
    public void fingerprintSignIn(PluginCall call) {
        Context context = getContext();
        MainActivity activity = mainActivity();
        if (!Fingerprint.hasSignIn(context) || activity == null) {
            call.reject("Nothing saved", "none");
            return;
        }
        Cipher cipher;
        try {
            cipher = Fingerprint.decryptCipher(context);
        } catch (KeyPermanentlyInvalidatedException e) {
            Fingerprint.deleteSignIn(context);
            call.reject("Fingerprints changed", "invalidated");
            return;
        } catch (Exception e) {
            Fingerprint.deleteSignIn(context);
            call.reject("Saved sign-in unreadable", "invalidated", e);
            return;
        }
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("כניסה ל-BizH")
            .setSubtitle(Fingerprint.signInEmail(context))
            .setNegativeButtonText("סיסמה")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setConfirmationRequired(false)
            .build();
        activity.authenticate(
            info,
            new BiometricPrompt.CryptoObject(cipher),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    try {
                        BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                        if (crypto == null || crypto.getCipher() == null) throw new IllegalStateException("No cipher");
                        JSONObject secret = new JSONObject(Fingerprint.readSignIn(context, crypto.getCipher()));
                        JSObject ret = new JSObject();
                        ret.put("email", secret.getString("email"));
                        ret.put("password", secret.getString("password"));
                        call.resolve(ret);
                    } catch (Exception e) {
                        Fingerprint.deleteSignIn(context);
                        call.reject("Saved sign-in unreadable", "invalidated", e);
                    }
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    call.reject(errString.toString(), promptErrorCode(errorCode));
                }
            }
        );
    }

    @PluginMethod
    public void deleteFingerprintSignIn(PluginCall call) {
        Fingerprint.deleteSignIn(getContext());
        call.resolve();
    }

    /**
     * Turn the app lock on ({on: true}: asks for the fingerprint / PIN once, so the
     * person knows it works; rejects "cancelled" if they back out) or off.
     */
    @PluginMethod
    public void setAppLock(PluginCall call) {
        Context context = getContext();
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        if (!on) {
            Fingerprint.setAppLock(context, false);
            call.resolve(lockResult(false));
            return;
        }
        MainActivity activity = mainActivity();
        if (!Fingerprint.canLock(context) || activity == null) {
            call.reject("No screen lock on this phone", "unavailable");
            return;
        }
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("נעילת BizH")
            .setSubtitle("אישור כדי להפעיל את הנעילה")
            .setAllowedAuthenticators(Fingerprint.LOCK_AUTHENTICATORS)
            .setConfirmationRequired(false)
            .build();
        activity.authenticate(
            info,
            null,
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    Fingerprint.setAppLock(context, true);
                    call.resolve(lockResult(true));
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    call.reject(errString.toString(), promptErrorCode(errorCode));
                }
            }
        );
    }

    private static JSObject lockResult(boolean on) {
        JSObject ret = new JSObject();
        ret.put("lockOn", on);
        return ret;
    }

    private static String promptErrorCode(int errorCode) {
        switch (errorCode) {
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_CANCELED:
                return "cancelled";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "lockout";
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL:
                return "unavailable";
            default:
                return "error";
        }
    }

    private MainActivity mainActivity() {
        Activity activity = getActivity();
        return activity instanceof MainActivity ? (MainActivity) activity : null;
    }

    // ---------------------------------------------------------------- shortcuts

    /**
     * Replace the long-press shortcuts: {items: [{id, label, url, icon}]}, url a
     * path of the site, icon one of task / order / delivery / search / reminder /
     * calendar / customer / project / payment / dashboard / attendance / income /
     * expense (anything else: the BizH mark). Shown in this order, as many as the
     * launcher allows.
     */
    @PluginMethod
    public void setShortcuts(PluginCall call) {
        JSArray items = call.getArray("items");
        if (items == null) {
            call.reject("Missing items", "invalid");
            return;
        }
        try {
            List<AppShortcuts.Item> list = new ArrayList<>();
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                String id = item.optString("id");
                String label = item.optString("label");
                String url = item.optString("url");
                if (id.isEmpty() || label.isEmpty() || url.isEmpty()) continue;
                list.add(new AppShortcuts.Item(id, label, url, item.optString("icon")));
            }
            AppShortcuts.set(getContext(), list);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not set the shortcuts", "error", e);
        }
    }
}
