package com.bizh.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONObject;

/**
 * "בוצע" and "לטיפול מחר" on a task alert (TaskAlert). The change goes straight
 * to the website's own API, signed in with the app's own login cookie, the same
 * way the app itself would send it:
 *
 *   בוצע         POST /api/tasks/update-status  {id, status: "done"}
 *   לטיפול מחר   POST /api/tasks/snooze         {task_id, until: tomorrow 08:00 Israel}
 *
 * If the server renews the login on the way (the cookie had expired), the
 * renewed cookie is written back, or the app's next open would sign in with the
 * old one and be logged out.
 */
public class TaskActionReceiver extends BroadcastReceiver {

    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 15000;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        String taskId = intent.getStringExtra(TaskAlert.EXTRA_TASK_ID);
        String title = intent.getStringExtra(TaskAlert.EXTRA_TITLE);
        String url = intent.getStringExtra(TaskAlert.EXTRA_URL);
        String tag = intent.getStringExtra(TaskAlert.EXTRA_TAG);
        if (!TaskAlert.isTaskId(taskId) || tag == null) return;
        boolean done = TaskAlert.ACTION_DONE.equals(action);
        if (!done && !TaskAlert.ACTION_TOMORROW.equals(action)) return;

        final String path;
        final String json;
        try {
            if (done) {
                path = "/api/tasks/update-status";
                json = new JSONObject().put("id", taskId).put("status", "done").toString();
            } else {
                path = "/api/tasks/snooze";
                json = new JSONObject().put("task_id", taskId).put("until", tomorrowMorningIsrael()).toString();
            }
        } catch (Exception e) {
            return;
        }

        // The web view's cookie store is read and written on the main thread
        // (onReceive runs there); only the request itself goes to a worker.
        CookieManager cookieManager = CookieManager.getInstance();
        String cookies = cookieManager.getCookie(MainActivity.SITE_ORIGIN);
        if (cookies == null || cookies.isEmpty()) {
            TaskAlert.showResult(context, tag, title, url, false, "צריך להתחבר לאפליקציה. הקש/י לפתיחה.");
            return;
        }

        TaskAlert.showSaving(context, tag, title, url);
        PendingResult pending = goAsync();
        Handler main = new Handler(Looper.getMainLooper());
        new Thread(() -> {
            Result result = post(path, json, cookies);
            main.post(() -> {
                try {
                    for (String cookie : result.setCookies) cookieManager.setCookie(MainActivity.SITE_ORIGIN, cookie);
                    if (!result.setCookies.isEmpty()) cookieManager.flush();
                    boolean saved = result.code >= 200 && result.code < 300 && confirmed(result.body, done);
                    String text;
                    if (saved) {
                        text = done ? "✓ סומנה כבוצעה" : "✓ תחזור מחר ב-08:00";
                    } else if (result.code == 401) {
                        text = "לא נשמר: צריך להתחבר לאפליקציה. הקש/י לפתיחה.";
                    } else if (result.code == 0) {
                        text = "לא נשמר: אין חיבור. הקש/י לפתיחת המשימה.";
                    } else {
                        text = "לא נשמר. הקש/י לפתיחת המשימה.";
                    }
                    TaskAlert.showResult(context, tag, title, url, saved, text);
                } finally {
                    pending.finish();
                }
            });
        }).start();
    }

    private static final class Result {
        final int code;
        final String body;
        final List<String> setCookies;

        Result(int code, String body, List<String> setCookies) {
            this.code = code;
            this.body = body;
            this.setCookies = setCookies;
        }
    }

    /**
     * The API's own word that it happened: update-status answers {task: null}
     * when no task was changed (deleted meanwhile, or not this person's to
     * change); snooze answers {ok: true}.
     */
    private static boolean confirmed(String body, boolean done) {
        try {
            JSONObject json = new JSONObject(body);
            return done ? json.optJSONObject("task") != null : json.optBoolean("ok", false);
        } catch (Exception e) {
            return false;
        }
    }

    /** POSTs JSON to the site; code 0 means it never got an answer (no signal). */
    private static Result post(String path, String json, String cookies) {
        HttpURLConnection connection = null;
        List<String> setCookies = new ArrayList<>();
        try {
            connection = (HttpURLConnection) new URL(MainActivity.SITE_ORIGIN + path).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(false);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Cookie", cookies);
            connection.setRequestProperty("User-Agent", "BizHApp/" + BuildConfig.VERSION_CODE + " (notification)");
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
            }
            int code = connection.getResponseCode();
            for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                if (header.getKey() != null && header.getKey().equalsIgnoreCase("Set-Cookie")) setCookies.addAll(header.getValue());
            }
            return new Result(code, readBody(connection, code), setCookies);
        } catch (Exception e) {
            return new Result(0, "", setCookies);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readBody(HttpURLConnection connection, int code) {
        try (InputStream in = code >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
            if (in == null) return "";
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            // The answers are small; never read more than 64 KB.
            while ((read = in.read(buffer)) != -1 && out.size() < 65536) out.write(buffer, 0, read);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    /** 08:00 tomorrow in Israel, as the website's "מחר" in "לטיפול בהמשך" picks it (lib/tasks/snooze.ts). */
    static String tomorrowMorningIsrael() {
        Calendar israel = Calendar.getInstance(TimeZone.getTimeZone("Asia/Jerusalem"));
        israel.add(Calendar.DAY_OF_MONTH, 1);
        israel.set(Calendar.HOUR_OF_DAY, 8);
        israel.set(Calendar.MINUTE, 0);
        israel.set(Calendar.SECOND, 0);
        israel.set(Calendar.MILLISECOND, 0);
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        return iso.format(israel.getTime());
    }
}
