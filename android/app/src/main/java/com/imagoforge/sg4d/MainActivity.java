package com.imagoforge.sg4d;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

/**
 * Hosts the SG 4D web app in a WebView.
 *
 * Unlike the offline games in this collection, the page is NOT loaded from
 * file:///android_asset. It is served through a WebViewAssetLoader on
 * https://appassets.androidplatform.net, which maps that virtual host straight
 * back onto the same asset folder. The files are identical; the origin is not,
 * and the origin is the entire point:
 *
 *   - fetch() to the exchange-rate APIs is an ordinary CORS request from a real
 *     https origin. From a file:// page the origin is "null", which is a
 *     category of request several WebView versions decline outright — the app
 *     would open to an empty board on exactly the devices we cannot test on.
 *   - localStorage gets a stable, per-app origin, so cached rates, alerts and
 *     settings survive an update instead of living under the opaque file
 *     origin.
 *   - Service workers only register on a secure origin, so the offline cache
 *     works in the APK the same way it does on the web.
 */
public class MainActivity extends Activity {

    private static final String APP_URL =
            "https://appassets.androidplatform.net/assets/www/index.html";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        // A service worker's own fetches do not pass through WebViewClient, so without this
        // the worker would go to the network for files that only exist inside the APK.
        // appassets.androidplatform.net never resolves there, so from the second launch on
        // (once sw.js controls the page) the app opened to a blank white screen.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                    new ServiceWorkerClientCompat() {
                        @Override
                        public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                            return loader.shouldInterceptRequest(request.getUrl());
                        }
                    });
        }

        webView = new WebView(this);
        // A WebView defaults to white, but says so explicitly here because the
        // page is light and any gap between the window appearing and the CSS
        // painting should not flash a different shade.
        webView.setBackgroundColor(Color.WHITE);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // Nothing is read off the filesystem directly - the loader serves assets.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        // Opt out of WebView's automatic darkening, explicitly.
        //
        // The page is light by design and says so with `color-scheme: light`.
        // On a phone in system dark mode WebView can still invert the content
        // for itself, and a user with "Override force-dark" switched on in
        // Developer Options gets that whatever the app targets. Saying no here
        // costs nothing and removes a whole class of "why is it dark" reports.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                // Only the virtual host is intercepted; requests to the results
                // feed fall through and go out over the network as normal.
                return loader.shouldInterceptRequest(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Only the bundled origin loads in this WebView, so its bridges never reach
                // another page. http(s) links go to the browser; any other scheme is dropped.
                Uri url = request.getUrl();
                if ("appassets.androidplatform.net".equals(url.getHost())) return false;
                String scheme = url.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    try {
                        view.getContext().startActivity(new Intent(Intent.ACTION_VIEW, url)
                                .addCategory(Intent.CATEGORY_BROWSABLE));
                    } catch (ActivityNotFoundException ignored) {
                        // No browser installed.
                    }
                }
                return true;
            }
        });

        // The results feed cannot be fetched from JavaScript - Singapore Pools
        // sends no CORS header - so Java does it. Scoped to that one host and
        // asynchronous; see NetBridge.java.
        webView.addJavascriptInterface(new NetBridge(webView), "AndroidNet");

        // AdHost wraps the WebView so the banner docks below it, and owns the
        // "AndroidAds" bridge and the ad lifecycle. See AdHost.java.
        View root = new AdHost(this, webView).root();
        // targetSdk 36 ignores the theme's edge-to-edge opt-out, so pad by the
        // system-bar insets to keep the page and the docked banner clear of the
        // status and nav bars. Consumed so the page's env(safe-area-inset-*)
        // padding does not add a second gap on top of this one.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }
}
