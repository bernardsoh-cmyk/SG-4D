package com.imagoforge.sg4d;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/**
 * The "AndroidNotify" bridge: the page's notification toggle.
 *
 * Kept deliberately small. The page can ask whether notifications are on,
 * turn them on or off, and ask the system for permission. It cannot post a
 * notification — only ResultWorker does that, and only for a draw it has
 * actually seen published.
 *
 * On Android 13 and up POST_NOTIFICATIONS is a runtime permission, so turning
 * the toggle on is two separate things: our own preference, and the user's
 * consent. Both have to be true, and the page reflects that rather than
 * claiming notifications are on while the system is silently dropping them.
 */
public class NotifyBridge {

    private final Activity activity;
    static final int REQUEST_CODE = 4201;

    NotifyBridge(Activity activity) { this.activity = activity; }

    private SharedPreferences prefs() {
        return activity.getSharedPreferences(ResultWorker.PREFS, Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public boolean available() { return true; }

    /** True only when the user wants them AND the system allows them. */
    @JavascriptInterface
    public boolean isEnabled() {
        return prefs().getBoolean(ResultWorker.KEY_ENABLED, false) && hasPermission();
    }

    @JavascriptInterface
    public boolean hasPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Ask the system for permission. Returns false when there is nothing to
     * ask — either it is already granted, or this Android is old enough not to
     * need it — so the page knows not to wait for an answer.
     */
    @JavascriptInterface
    public boolean requestPermission() {
        if (hasPermission()) return false;
        ActivityCompat.requestPermissions(
                activity, new String[]{ Manifest.permission.POST_NOTIFICATIONS }, REQUEST_CODE);
        return true;
    }

    @JavascriptInterface
    public void setEnabled(boolean on) {
        prefs().edit().putBoolean(ResultWorker.KEY_ENABLED, on).apply();
        if (on) ResultWorker.scheduleNext(activity);
        else ResultWorker.cancel(activity);
    }
}
