package com.imagoforge.sg4d;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.Calendar;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

/**
 * Checks whether a draw has been published and, if so, says so.
 *
 * Why this and not Firebase. A push has to be sent by something that knows the
 * result is out, and nothing does sooner than the device itself: the Actions
 * cron that publishes our feed runs on GitHub's best-effort scheduler and has
 * landed anywhere from 16 minutes to four hours after a draw. Routing a
 * notification through it would make it later, not sooner, while adding a
 * Firebase project, a service-account secret and a data-collection disclosure
 * to a gambling-adjacent store listing. So the phone reads Singapore Pools
 * directly, exactly as the foreground app does, and notifies itself. Nothing
 * leaves the device and there is no server to keep alive.
 *
 * What it cannot promise. Android does not run background work to the minute —
 * WorkManager will not schedule below a 15-minute floor, and Doze can push a
 * job later still. Expect a notification within about fifteen minutes of a
 * result appearing, often sooner, not within seconds. The foreground app stays
 * the fast path at roughly thirty seconds.
 */
public class ResultWorker extends Worker {

    static final String PREFS = "sg4d.notify";
    static final String KEY_ENABLED = "enabled";
    private static final String KEY_LAST_PREFIX = "lastNotifiedDraw.";
    private static final String KEY_LM_PREFIX = "lastModified.";
    private static final String CHANNEL_ID = "results";
    private static final String WORK_NAME = "sg4d.resultCheck";

    /* Draw times in SGT. Sweep is monthly, on the first Wednesday. */
    private static final int[] FOURD_DAYS = { Calendar.WEDNESDAY, Calendar.SATURDAY, Calendar.SUNDAY };
    private static final int[] TOTO_DAYS = { Calendar.MONDAY, Calendar.THURSDAY };

    /* Start looking ten minutes after a draw - the earliest a result has been
     * observed - and give up for that draw after three hours. */
    private static final long EARLIEST_MIN = 10;
    private static final long GIVE_UP_MIN = 180;
    private static final long RETRY_MIN = 15;     // WorkManager's practical floor

    public ResultWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!sp.getBoolean(KEY_ENABLED, false)) return Result.success();   // turned off

        boolean anyStillPending = false;

        for (String game : Pools.GAMES) {
            if (!inWindow(game)) continue;
            anyStillPending = true;
            try {
                String lm = sp.getString(KEY_LM_PREFIX + game, null);
                Pools.Response res = Pools.get(Pools.topDrawsUrl(game), lm);
                if (res.status == 304) continue;                 // nothing new, free
                Pools.Latest latest = Pools.parseLatest(game, res.body);
                if (latest == null) continue;

                sp.edit().putString(KEY_LM_PREFIX + game, res.lastModified).apply();

                int already = sp.getInt(KEY_LAST_PREFIX + game, 0);
                if (latest.draw > already) {
                    notifyResult(ctx, game, latest);
                    sp.edit().putInt(KEY_LAST_PREFIX + game, latest.draw).apply();
                    anyStillPending = false;                     // this game is done
                }
            } catch (Exception e) {
                // A failed check is not a failed worker: try again on the next
                // pass rather than burning WorkManager's retry budget.
            }
        }

        schedule(ctx, anyStillPending ? RETRY_MIN : minutesUntilNextWindow());
        return Result.success();
    }

    /* ---------------- scheduling ---------------- */

    private static Calendar sgNow() {
        return Calendar.getInstance(TimeZone.getTimeZone("Asia/Singapore"));
    }

    private static boolean isDrawDay(String game, Calendar c) {
        int dow = c.get(Calendar.DAY_OF_WEEK);
        if ("sweep".equals(game)) {
            return dow == Calendar.WEDNESDAY && c.get(Calendar.DAY_OF_MONTH) <= 7;
        }
        int[] days = "toto".equals(game) ? TOTO_DAYS : FOURD_DAYS;
        for (int d : days) if (d == dow) return true;
        return false;
    }

    /** Draw time for `game` on the day `c` falls on, in millis. */
    private static long drawTime(String game, Calendar c) {
        Calendar t = (Calendar) c.clone();
        t.set(Calendar.HOUR_OF_DAY, "sweep".equals(game) ? 18 : 18);
        t.set(Calendar.MINUTE, "sweep".equals(game) ? 0 : 30);
        t.set(Calendar.SECOND, 0);
        t.set(Calendar.MILLISECOND, 0);
        return t.getTimeInMillis();
    }

    /** Are we inside this game's "a result could be up by now" window? */
    private static boolean inWindow(String game) {
        Calendar now = sgNow();
        if (!isDrawDay(game, now)) return false;
        long since = now.getTimeInMillis() - drawTime(game, now);
        return since >= EARLIEST_MIN * 60000 && since <= GIVE_UP_MIN * 60000;
    }

    /** Minutes until the next game's window opens, so we sleep until then. */
    private static long minutesUntilNextWindow() {
        Calendar now = sgNow();
        long soonest = Long.MAX_VALUE;
        for (int ahead = 0; ahead < 40; ahead++) {
            Calendar day = (Calendar) now.clone();
            day.add(Calendar.DAY_OF_YEAR, ahead);
            for (String game : Pools.GAMES) {
                if (!isDrawDay(game, day)) continue;
                long open = drawTime(game, day) + EARLIEST_MIN * 60000;
                if (open > now.getTimeInMillis()) soonest = Math.min(soonest, open);
            }
            if (soonest != Long.MAX_VALUE) break;
        }
        if (soonest == Long.MAX_VALUE) return 60 * 24;
        return Math.max(1, (soonest - now.getTimeInMillis()) / 60000);
    }

    /** Queue the next check. Replaces any pending one, so this cannot pile up. */
    static void schedule(Context ctx, long delayMinutes) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(ResultWorker.class)
                .setInitialDelay(delayMinutes, TimeUnit.MINUTES)
                .build();
        WorkManager.getInstance(ctx)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, req);
    }

    static void cancel(Context ctx) {
        WorkManager.getInstance(ctx).cancelUniqueWork(WORK_NAME);
    }

    /** Called when the toggle goes on, and on every app start while it is on. */
    static void scheduleNext(Context ctx) {
        boolean windowOpen = false;
        for (String game : Pools.GAMES) if (inWindow(game)) { windowOpen = true; break; }
        schedule(ctx, windowOpen ? 1 : minutesUntilNextWindow());
    }

    /* ---------------- the notification ---------------- */

    private void notifyResult(Context ctx, String game, Pools.Latest latest) {
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Draw results", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("One notification per draw, when the result is published.");
            nm.createNotificationChannel(ch);
        }

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String title = Pools.label(game) + " result is out";
        String text = "sweep".equals(game)
                ? "1st Prize " + latest.headline + " · " + latest.date
                : ("toto".equals(game)
                    ? latest.headline + " · " + latest.date
                    : "1st Prize " + latest.headline + " · " + latest.date);

        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();

        try {
            // Android 13+ can refuse this if the user never granted the
            // permission; that is their call, and it must not crash a worker.
            NotificationManagerCompat.from(ctx).notify(game.hashCode(), n);
        } catch (SecurityException ignored) { }
    }
}
