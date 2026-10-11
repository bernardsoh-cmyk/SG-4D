package com.imagoforge.sg4d;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.LinearLayout;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;

/**
 * Self-contained AdMob host for a WebView app.
 *
 * MainActivity only has to hand over its WebView and use root() as the content
 * view - everything else (layout, ad loading, the "AndroidAds" JavaScript
 * bridge, and the activity lifecycle) is owned here. That keeps the ad code
 * identical across every app instead of forked into each activity.
 *
 * The banner is docked in its own row BELOW the WebView rather than floating
 * over it. An overlay would sit on top of the chart and earn accidental taps,
 * which is exactly what gets an AdMob account suspended.
 *
 * Ad unit ids come from res/values/ads.xml (test ids) with a release-only
 * override in src/release/res/values/ads.xml.
 */
public final class AdHost {

    private final Activity activity;
    private final WebView webView;
    private final LinearLayout root;
    private final View privacyLink;
    private final AdView banner;

    private volatile InterstitialAd interstitial;
    private volatile RewardedAd rewarded;
    // UI thread only. A second tap while an ad is on screen used to report
    // reward=false, which cleared ads.js's callback and lost the real reward.
    private boolean rewardedShowing;
    private volatile boolean bannerEnabled = true;

    public AdHost(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;

        root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);

        webView.addJavascriptInterface(new AdBridge(), "AndroidAds");
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        // Sits between the app and the banner, and stays hidden unless the user's
        // region requires a standing way to change consent.
        privacyLink = ConsentGate.attachPrivacyLink(activity, root);

        banner = new AdView(activity);
        banner.setAdUnitId(activity.getString(R.string.admob_banner_id));
        banner.setAdSize(adaptiveBannerSize());
        // Hidden until an ad actually arrives, so a failed load leaves no gap.
        banner.setVisibility(View.GONE);
        banner.setAdListener(new AdListener() {
            @Override
            public void onAdLoaded() {
                if (bannerEnabled) banner.setVisibility(View.VISIBLE);
            }

            @Override
            public void onAdFailedToLoad(LoadAdError error) {
                banner.setVisibility(View.GONE);
            }

            @Override
            public void onAdImpression() {
                toWeb("banner", true);
            }
        });
        root.addView(banner, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // Nothing is requested until UMP says this user may be served ads. In the
        // EEA that means after the consent form; everywhere else it resolves at once.
        ConsentGate.gather(activity, privacyLink, this::startAds);

        registerLifecycle();
    }

    private void startAds() {
        MobileAds.initialize(activity, status -> {
            banner.loadAd(new AdRequest.Builder().build());
            loadInterstitial();
            loadRewarded();
        });
    }

    /** The view MainActivity should pass to setContentView(). */
    public View root() {
        return root;
    }

    private AdSize adaptiveBannerSize() {
        DisplayMetrics dm = activity.getResources().getDisplayMetrics();
        int widthDp = (int) (dm.widthPixels / dm.density);
        return AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(activity, widthDp);
    }

    /* ---------------- ad loading ---------------- */

    private void loadInterstitial() {
        InterstitialAd.load(activity, activity.getString(R.string.admob_interstitial_id),
                new AdRequest.Builder().build(),
                new InterstitialAdLoadCallback() {
                    @Override
                    public void onAdLoaded(InterstitialAd ad) {
                        interstitial = ad;
                    }

                    @Override
                    public void onAdFailedToLoad(LoadAdError error) {
                        interstitial = null;
                    }
                });
    }

    private void loadRewarded() {
        RewardedAd.load(activity, activity.getString(R.string.admob_rewarded_id),
                new AdRequest.Builder().build(),
                new RewardedAdLoadCallback() {
                    @Override
                    public void onAdLoaded(RewardedAd ad) {
                        rewarded = ad;
                    }

                    @Override
                    public void onAdFailedToLoad(LoadAdError error) {
                        rewarded = null;
                    }
                });
    }

    /** Reports an ad outcome back to ads.js. */
    private void toWeb(final String kind, final boolean ok) {
        activity.runOnUiThread(() -> webView.evaluateJavascript(
                "window.__adCallback && window.__adCallback('" + kind + "'," + ok + ")", null));
    }

    /* ---------------- JS bridge ---------------- */

    private class AdBridge {

        @JavascriptInterface
        public boolean available() {
            return true;
        }

        @JavascriptInterface
        public boolean interstitialReady() {
            return interstitial != null;
        }

        @JavascriptInterface
        public boolean rewardedReady() {
            return rewarded != null;
        }

        /**
         * True where the user must be able to revisit their consent choice. The
         * app can surface its own menu entry instead of the docked link.
         */
        @JavascriptInterface
        public boolean privacyOptionsRequired() {
            return ConsentGate.privacyOptionsRequired(activity);
        }

        /** Reopens the consent form so the user can change or withdraw consent. */
        @JavascriptInterface
        public void showPrivacyOptions() {
            activity.runOnUiThread(() -> ConsentGate.showPrivacyOptions(activity));
        }

        /** Turned off for good once the user pays to remove ads. */
        @JavascriptInterface
        public void setBannerEnabled(final boolean on) {
            bannerEnabled = on;
            activity.runOnUiThread(() -> banner.setVisibility(on ? View.VISIBLE : View.GONE));
        }

        @JavascriptInterface
        public void showInterstitial() {
            activity.runOnUiThread(() -> {
                InterstitialAd ad = interstitial;
                if (ad == null) {
                    loadInterstitial();
                    toWeb("interstitial", false);
                    return;
                }
                interstitial = null;
                ad.setFullScreenContentCallback(new FullScreenContentCallback() {
                    @Override
                    public void onAdDismissedFullScreenContent() {
                        loadInterstitial();
                    }

                    @Override
                    public void onAdFailedToShowFullScreenContent(AdError error) {
                        loadInterstitial();
                        toWeb("interstitial", false);
                    }

                    @Override
                    public void onAdImpression() {
                        toWeb("interstitial", true);
                    }
                });
                ad.show(activity);
            });
        }

        @JavascriptInterface
        public void showRewarded() {
            activity.runOnUiThread(() -> {
                if (rewardedShowing) return;
                RewardedAd ad = rewarded;
                if (ad == null) {
                    loadRewarded();
                    toWeb("reward", false);
                    return;
                }
                rewarded = null;
                rewardedShowing = true;
                final boolean[] earned = { false };
                ad.setFullScreenContentCallback(new FullScreenContentCallback() {
                    @Override
                    public void onAdDismissedFullScreenContent() {
                        rewardedShowing = false;
                        loadRewarded();
                        if (!earned[0]) toWeb("reward", false);   // closed early
                    }

                    @Override
                    public void onAdFailedToShowFullScreenContent(AdError error) {
                        rewardedShowing = false;
                        loadRewarded();
                        toWeb("reward", false);
                    }
                });
                ad.show(activity, reward -> {
                    earned[0] = true;
                    toWeb("reward", true);
                });
            });
        }
    }

    /* ---------------- lifecycle ---------------- */

    /*
     * Hooking the lifecycle here rather than from MainActivity is deliberate: it
     * means adding ads to an app touches exactly one line of its activity, so
     * fifteen apps cannot drift into fifteen slightly different versions.
     */
    private void registerLifecycle() {
        final Application app = activity.getApplication();
        app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override
            public void onActivityPaused(Activity a) {
                if (a == activity) banner.pause();
            }

            @Override
            public void onActivityResumed(Activity a) {
                if (a == activity) banner.resume();
            }

            @Override
            public void onActivityDestroyed(Activity a) {
                if (a != activity) return;
                banner.destroy();
                app.unregisterActivityLifecycleCallbacks(this);
            }

            @Override
            public void onActivityCreated(Activity a, Bundle b) { }

            @Override
            public void onActivityStarted(Activity a) { }

            @Override
            public void onActivityStopped(Activity a) { }

            @Override
            public void onActivitySaveInstanceState(Activity a, Bundle b) { }
        });
    }
}
