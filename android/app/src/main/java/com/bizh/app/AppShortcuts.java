package com.bizh.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Long-press the BizH icon (APK 1.2; owner's picks, 2026-10-11): משלוחים,
 * הזמנה חדשה, משימה חדשה, חיפוש. Each opens a page of the site in the app; the
 * "new" ones open the + menu's own form (?quick=…, components/layout/QuickCreateMenu.tsx).
 *
 * Kept as the app's dynamic shortcuts, not a fixed list in the manifest: Android
 * starts a fixed shortcut on a cleared app (the opening screen again, the page
 * you were on gone), while these go to the open app like any link. The website
 * can also replace them (BizHNative.setShortcuts), e.g. per role, from the icons
 * below, without a new APK.
 */
final class AppShortcuts {

    static final class Item {
        final String id;
        final String label;
        final String path;
        final String icon;

        Item(String id, String label, String path, String icon) {
            this.id = id;
            this.label = label;
            this.path = path;
            this.icon = icon;
        }
    }

    /** The owner's order; the first sits nearest the icon. */
    static final Item[] DEFAULTS = {
        new Item("deliveries", "משלוחים", "/deliveries", "delivery"),
        new Item("new-order", "הזמנה חדשה", "/dashboard?quick=order", "order"),
        new Item("new-task", "משימה חדשה", "/dashboard?quick=task", "task"),
        new Item("search", "חיפוש", "/dashboard?quick=search", "search"),
    };

    private AppShortcuts() {}

    /** On the first open of a new install or update; the website's own list stays otherwise. */
    static void setDefaultsOnce(Context context) {
        try {
            String marker = "shortcuts_" + BuildConfig.VERSION_CODE;
            SharedPreferences prefs = context.getSharedPreferences(Fingerprint.PREFS, Context.MODE_PRIVATE);
            if (prefs.getBoolean(marker, false) && !ShortcutManagerCompat.getDynamicShortcuts(context).isEmpty()) return;
            set(context, Arrays.asList(DEFAULTS));
            prefs.edit().putBoolean(marker, true).apply();
        } catch (Exception e) {
            // A launcher without shortcuts: nothing to do.
        }
    }

    static void set(Context context, List<Item> items) {
        List<ShortcutInfoCompat> shortcuts = new ArrayList<>();
        int max = ShortcutManagerCompat.getMaxShortcutCountPerActivity(context);
        for (int i = 0; i < items.size() && shortcuts.size() < max; i++) {
            Item item = items.get(i);
            Intent intent = new Intent(context, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(IncomingCall.siteUrl(item.path)));
            shortcuts.add(
                new ShortcutInfoCompat.Builder(context, item.id)
                    .setShortLabel(item.label)
                    .setLongLabel(item.label)
                    .setIcon(IconCompat.createWithResource(context, iconFor(item.icon)))
                    .setIntent(intent)
                    .setRank(i)
                    .build()
            );
        }
        ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts);
    }

    /** The icons a shortcut can wear; anything else gets the BizH mark. */
    static int iconFor(String name) {
        if (name == null) return R.drawable.ic_shortcut_bizh;
        switch (name) {
            case "task":
                return R.drawable.ic_shortcut_task;
            case "order":
                return R.drawable.ic_shortcut_order;
            case "delivery":
                return R.drawable.ic_shortcut_delivery;
            case "search":
                return R.drawable.ic_shortcut_search;
            // Spares for the website to use without a new APK.
            case "reminder":
                return R.drawable.ic_shortcut_reminder;
            case "calendar":
                return R.drawable.ic_shortcut_calendar;
            case "customer":
                return R.drawable.ic_shortcut_customer;
            case "project":
                return R.drawable.ic_shortcut_project;
            case "payment":
                return R.drawable.ic_shortcut_payment;
            case "dashboard":
                return R.drawable.ic_shortcut_dashboard;
            case "attendance":
                return R.drawable.ic_shortcut_attendance;
            case "income":
                return R.drawable.ic_shortcut_income;
            case "expense":
                return R.drawable.ic_shortcut_expense;
            default:
                return R.drawable.ic_shortcut_bizh;
        }
    }
}
