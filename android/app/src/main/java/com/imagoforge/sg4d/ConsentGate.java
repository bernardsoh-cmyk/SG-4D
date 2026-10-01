package com.imagoforge.sg4d;

import android.app.Activity;
import android.graphics.Color;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.ump.ConsentDebugSettings;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * GDPR consent gate that runs in front of the ad SDK.
 *
 * Google's User Messaging Platform decides, from the user's region, whether a
 * consent form is needed at all. Outside a consent region this resolves in one
 * pass and costs nothing; inside the EEA and the UK it shows the form and stores
 * the answer, and no ad request is allowed until it has.
 *
 * Nothing here needs a dependency of its own - UMP 4.x arrives transitively with
 * play-services-ads.
 */
final class ConsentGate {

    private ConsentGate() { }

    /**
     * Resolves consent, then runs startAds exactly once if ads are permitted.
     *
     * @param privacyLink optional view revealed only where law requires a standing
     *                    way to change consent; pass null if the app has none.
     */
    static void gather(final Activity activity, final View privacyLink, final Runnable startAds) {
        final ConsentInformation info = UserMessagingPlatform.getConsentInformation(activity);

        // Both the callback path and the fast path below can decide ads are allowed.
        // Without this guard a returning user would load every ad slot twice.
        final AtomicBoolean started = new AtomicBoolean(false);
        final Runnable once = new Runnable() {
            @Override
            public void run() {
                if (privacyLink != null) {
                    privacyLink.setVisibility(
                            privacyOptionsRequired(activity) ? View.VISIBLE : View.GONE);
                }
                if (started.compareAndSet(false, true)) startAds.run();
            }
        };

        ConsentRequestParameters.Builder params = new ConsentRequestParameters.Builder()
                .setTagForUnderAgeOfConsent(false);

        // Forces the EEA form from anywhere, for testing. The hash is empty in
        // main/ and only set in src/debug/res/values/ads_debug.xml, so a release
        // build cannot carry it however this is edited - which matters, because
        // shipping it would show the form worldwide and wreck consent rates.
        String testHash = activity.getString(R.string.admob_test_device_hash);
        if (!testHash.isEmpty()) {
            params.setConsentDebugSettings(new ConsentDebugSettings.Builder(activity)
                    .setDebugGeography(ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_EEA)
                    .addTestDeviceHashedId(testHash)
                    .build());
            // Otherwise the form appears once and never again, which makes the
            // form itself impossible to iterate on.
            info.reset();
        }

        info.requestConsentInfoUpdate(activity, params.build(),
                () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity, formError -> {
                    // Reached whether a form was shown, dismissed, or never needed.
                    if (info.canRequestAds()) once.run();
                }),
                requestError -> {
                    // Offline, or the form could not be fetched. Fall back to the
                    // consent stored from a previous run rather than killing ads
                    // for good - canRequestAds() stays false if none was given.
                    if (info.canRequestAds()) once.run();
                });

        // A user who consented on an earlier run is already cleared, so ads start
        // immediately instead of waiting on the network round trip above.
        if (info.canRequestAds()) once.run();
    }

    /** True where the user must be offered a standing way to change their choice. */
    static boolean privacyOptionsRequired(Activity activity) {
        return UserMessagingPlatform.getConsentInformation(activity)
                .getPrivacyOptionsRequirementStatus()
                == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
    }

    /** Reopens the consent form so the user can change or withdraw consent. */
    static void showPrivacyOptions(Activity activity) {
        UserMessagingPlatform.showPrivacyOptionsForm(activity, formError -> { });
    }

    /**
     * Adds the "Privacy settings" entry point to a vertical root layout, hidden
     * until gather() finds it is required.
     *
     * Building it here rather than in each app's own UI is deliberate: the
     * requirement is legal, not cosmetic, and eighteen hand-placed buttons would
     * be eighteen chances to forget one.
     */
    static View attachPrivacyLink(final Activity activity, LinearLayout root) {
        TextView link = new TextView(activity);
        link.setText("Privacy settings");
        link.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f);
        link.setTextColor(Color.parseColor("#9AA0A6"));
        link.setBackgroundColor(Color.parseColor("#11000000"));
        link.setGravity(Gravity.CENTER);
        link.setPadding(0, 18, 0, 18);
        link.setVisibility(View.GONE);
        link.setOnClickListener(v -> showPrivacyOptions(activity));
        root.addView(link, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return link;
    }
}
