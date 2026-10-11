package com.imagoforge.sg4d;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The "AndroidNet" bridge: lets the web app read a Singapore Pools results page
 * that JavaScript cannot fetch on its own.
 *
 * Why it has to exist at all. Singapore Pools serves no
 * Access-Control-Allow-Origin header, so a fetch() from the WebView's page is
 * refused by the browser before it ever reaches the network — not a 403 we
 * could handle, a hard block. Java is not bound by CORS, so the request works
 * here. The app's normal source of results is the hosted JSON feed; this is the
 * fallback for when that feed is missing or behind.
 *
 * Two design decisions worth stating plainly, because both are easy to get
 * wrong in a WebView bridge:
 *
 *   It is ASYNCHRONOUS. A @JavascriptInterface method runs on a binder thread,
 *   but the JavaScript that called it is blocked until the method returns, so a
 *   synchronous network call here would freeze the page for the duration of
 *   every request. Instead request() returns immediately, the work happens on
 *   an executor, and the result is handed back by calling window.__netCallback.
 *
 *   It is NOT a general-purpose fetch. A bridge that will retrieve any URL on
 *   command is a serious liability the moment anything untrusted reaches the
 *   page. This one refuses everything that is not https on the one host it
 *   exists to read, caps the response size, and returns text only. It cannot
 *   POST, cannot send credentials, and follows no redirect off-host.
 */
public class NetBridge {

    private static final String ALLOWED_HOST = "www.singaporepools.com.sg";
    private static final int MAX_BYTES = 512 * 1024;
    private static final int TIMEOUT_MS = 20000;
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/128.0 Mobile Safari/537.36";

    private final WebView webView;
    private final ExecutorService pool = Executors.newSingleThreadExecutor();

    NetBridge(WebView webView) {
        this.webView = webView;
    }

    /** Probed by data.js to decide whether the live fallback is available at all. */
    @JavascriptInterface
    public boolean available() {
        return true;
    }

    /**
     * Fetch `url` and hand the result to
     * window.__netCallback(id, ok, body, status, lastModified).
     *
     * `ifModifiedSince` may be empty. When it carries a Last-Modified value
     * from an earlier response, the server is free to answer 304 with no body,
     * and that is reported as status 304 with an empty body rather than as an
     * error. The page polls on this: an unchanged file costs nothing.
     *
     * Returns immediately; never throws into JavaScript.
     */
    @JavascriptInterface
    public void request(final String url, final String requestId, final String ifModifiedSince) {
        pool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    fetch(url, ifModifiedSince, requestId);
                } catch (Exception e) {
                    deliver(requestId, false, String.valueOf(e.getMessage()), 0, null);
                }
            }
        });
    }

    private void fetch(String rawUrl, String ifModifiedSince, String requestId) throws Exception {
        URL url = new URL(rawUrl);
        if (!"https".equals(url.getProtocol()) || !ALLOWED_HOST.equals(url.getHost())) {
            throw new SecurityException("blocked: " + url.getProtocol() + "://" + url.getHost());
        }

        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setInstanceFollowRedirects(true);
            conn.setUseCaches(false);
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "text/html,application/xhtml+xml");
            if (ifModifiedSince != null && ifModifiedSince.length() > 0) {
                conn.setRequestProperty("If-Modified-Since", ifModifiedSince);
            }

            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_NOT_MODIFIED) {
                deliver(requestId, true, "", code, ifModifiedSince);
                return;
            }
            if (code != HttpURLConnection.HTTP_OK) throw new Exception("HTTP " + code);

            // A redirect can only ever land back on the allowed host, because
            // HttpURLConnection will not follow one across protocols and we
            // re-check the host we actually ended up on.
            String finalHost = conn.getURL().getHost();
            if (!ALLOWED_HOST.equals(finalHost)) throw new SecurityException("redirected off-host: " + finalHost);

            InputStream in = conn.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n, total = 0;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > MAX_BYTES) throw new Exception("response too large");
                out.write(buf, 0, n);
            }
            in.close();
            deliver(requestId, true, out.toString("UTF-8"), code, conn.getHeaderField("Last-Modified"));
        } finally {
            conn.disconnect();
        }
    }

    private void deliver(final String requestId, final boolean ok, final String payload,
                         final int status, final String lastModified) {
        // JSONObject.quote does the escaping, so a page full of quotes, newlines
        // and angle brackets cannot break out of the string literal.
        final String js = "window.__netCallback && window.__netCallback("
                + JSONObject.quote(requestId) + "," + ok + "," + JSONObject.quote(payload)
                + "," + status + ","
                + (lastModified == null ? "null" : JSONObject.quote(lastModified)) + ")";
        webView.post(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(js, null);
            }
        });
    }
}
