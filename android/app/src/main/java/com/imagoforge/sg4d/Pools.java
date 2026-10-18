package com.imagoforge.sg4d;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reading Singapore Pools from Java.
 *
 * NetBridge serves the WebView and ResultWorker runs with no WebView at all,
 * but both need the same two things: a narrowly scoped fetch, and just enough
 * parsing to identify the newest draw. Keeping that in one place is what stops
 * the background check and the foreground one disagreeing about what "the
 * latest result" is.
 *
 * The parsing here is deliberately shallow — draw number, date, headline
 * number. The full parse lives in data.js, which has the whole document and a
 * real DOM. A notification only needs to say what came out.
 */
final class Pools {

    static final String HOST = "www.singaporepools.com.sg";
    private static final String ARCHIVE =
            "https://" + HOST + "/DataFileArchive/Lottery/Output/";

    static final String[] GAMES = { "fourd", "toto", "sweep" };

    private static final int MAX_BYTES = 512 * 1024;
    private static final int TIMEOUT_MS = 20000;
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/128.0 Mobile Safari/537.36";

    private Pools() {}

    static String topDrawsUrl(String game) {
        if ("toto".equals(game)) return ARCHIVE + "toto_result_top_draws_en.html";
        if ("sweep".equals(game)) return ARCHIVE + "sweep_result_top_draws_en.html";
        return ARCHIVE + "fourd_result_top_draws_en.html";
    }

    static String label(String game) {
        if ("toto".equals(game)) return "TOTO";
        if ("sweep".equals(game)) return "Singapore Sweep";
        return "4D";
    }

    /** A fetch result. body is null when the server answered 304. */
    static final class Response {
        final int status;
        final String body;
        final String lastModified;
        Response(int status, String body, String lastModified) {
            this.status = status; this.body = body; this.lastModified = lastModified;
        }
    }

    /**
     * HTTPS GET, restricted to the one host this app reads. Honours a
     * conditional request, so a check costs nothing when nothing has changed.
     */
    static Response get(String rawUrl, String ifModifiedSince) throws Exception {
        URL url = new URL(rawUrl);
        if (!"https".equals(url.getProtocol()) || !HOST.equals(url.getHost())) {
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
                return new Response(code, null, ifModifiedSince);
            }
            if (code != HttpURLConnection.HTTP_OK) throw new Exception("HTTP " + code);
            if (!HOST.equals(conn.getURL().getHost())) {
                throw new SecurityException("redirected off-host: " + conn.getURL().getHost());
            }

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
            return new Response(code, out.toString("UTF-8"), conn.getHeaderField("Last-Modified"));
        } finally {
            conn.disconnect();
        }
    }

    /** The newest draw in a top-draws file, as far as a notification needs it. */
    static final class Latest {
        final int draw;
        final String date;       // as printed, e.g. "Sun, 18 Oct 2026"
        final String headline;   // 1st prize, or the six numbers for TOTO
        Latest(int draw, String date, String headline) {
            this.draw = draw; this.date = date; this.headline = headline;
        }
    }

    private static final Pattern DRAW_NO =
            Pattern.compile("class='drawNumber'[^>]*>\\s*Draw No\\.\\s*(\\d+)");
    private static final Pattern DRAW_DATE =
            Pattern.compile("<th[^>]*class='drawDate'[^>]*>\\s*([^<]+?)\\s*</th>");
    private static final Pattern FIRST_4D =
            Pattern.compile("class='tdFirstPrize'[^>]*>\\s*(\\d{4})");
    private static final Pattern WIN_N =
            Pattern.compile("class='win(\\d)'[^>]*>\\s*(\\d+)");
    private static final Pattern SWEEP_FIRST =
            Pattern.compile("class='valueFirstPrize'[^>]*>\\s*([\\d\\s]+?)\\s*<");

    /** Returns null when the markup does not look like a result. */
    static Latest parseLatest(String game, String body) {
        if (body == null) return null;
        Matcher no = DRAW_NO.matcher(body);
        Matcher date = DRAW_DATE.matcher(body);
        if (!no.find() || !date.find()) return null;
        int draw = Integer.parseInt(no.group(1));
        String when = date.group(1);

        if ("toto".equals(game)) {
            StringBuilder sb = new StringBuilder();
            Matcher m = WIN_N.matcher(body);
            int seen = 0;
            while (m.find() && seen < 6) {
                if (sb.length() > 0) sb.append(' ');
                sb.append(m.group(2));
                seen++;
            }
            return seen == 6 ? new Latest(draw, when, sb.toString()) : null;
        }
        if ("sweep".equals(game)) {
            Matcher m = SWEEP_FIRST.matcher(body);
            return m.find() ? new Latest(draw, when, m.group(1).replaceAll("\\s+", " ")) : null;
        }
        Matcher m = FIRST_4D.matcher(body);
        return m.find() ? new Latest(draw, when, m.group(1)) : null;
    }
}
