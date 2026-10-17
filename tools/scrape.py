#!/usr/bin/env python3
"""
Singapore Pools scraper: 4D, TOTO and Singapore Sweep.

Stdlib only, on purpose: this runs in a GitHub Actions cron with no pip step.

How the site works, since none of it is documented anywhere. Each game exposes
three things under /DataFileArchive/Lottery/Output/ and /en/product/Pages/:

  top-draws   a small static file holding the most recent draws COMPLETE.
              One request gets 6 draws for 4D and TOTO, 1 for Sweep. It also
              answers a conditional request with 304, which is what lets the
              app poll it cheaply - see data.js.
  draw list   a bare <select>, one <option> per draw going back years, each
              carrying the draw number and a `queryString` of sppl=<base64>,
              where the base64 decodes to the literal text "DrawNumber=5547".
              That is the whole authentication story: there isn't one.
  page        one draw, addressed by that sppl value.

So a run costs ONE request per game in the steady state, and only reaches for
individual pages when backfilling history.

Note the page paths. 4D's used to be /en/product/sr/Pages/ and that now 404s,
which is the failure mode to expect from this source: not an error, a redirect
to a 200 "page not found". Hence assert_looks_like_results - a silent redirect
must break the build, not quietly write an empty history.

There is no Access-Control-Allow-Origin on any of it, so the web app can never
fetch these directly. That is why this exists: it runs on a schedule, and the
app reads the JSON it produces.
"""

import argparse
import base64
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

HOST = "https://www.singaporepools.com.sg"
ARCHIVE = HOST + "/DataFileArchive/Lottery/Output/"
PAGES = HOST + "/en/product/Pages/"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
SGT = timezone(timedelta(hours=8))

# Polite: the site is not ours and a backfill is hundreds of requests.
DELAY_S = 0.4
RETRIES = 3


# ---------------------------------------------------------------- fetching

def fetch(url):
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace"), r.geturl()
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("fetch failed after %d tries: %s (%s)" % (RETRIES, url, last))


def assert_looks_like_results(body, final_url, what):
    """A moved page returns 200 on an error page rather than a 404. Catch that."""
    if "PageNotFoundError" in final_url:
        raise RuntimeError(
            "redirected to the site's not-found page for %s -- a results URL has "
            "moved again; fix the GAMES table in this file" % what)
    if "drawNumber" not in body:
        raise RuntimeError("no drawNumber anchor in %s; the markup changed" % what)


# ---------------------------------------------------------------- text helpers

TAGS = re.compile(r"<[^>]+>")
WS = re.compile(r"\s+")


def text_of(fragment):
    return html.unescape(WS.sub(" ", TAGS.sub(" ", fragment))).strip()


def find_all(pattern, body, flags=re.S):
    return re.findall(pattern, body, flags)


def one(pattern, body, what, flags=re.S):
    m = re.search(pattern, body, flags)
    if not m:
        raise RuntimeError("could not find %s" % what)
    return m.group(1)


def maybe(pattern, body, flags=re.S):
    m = re.search(pattern, body, flags)
    return m.group(1) if m else None


DATE_RE = re.compile(r"(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})")
MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def iso_date(label):
    m = DATE_RE.search(label)
    if not m:
        raise RuntimeError("unparseable date: %r" % label)
    d, mon, y = m.group(1), m.group(2)[:3].title(), m.group(3)
    return "%s-%02d-%02d" % (y, MONTHS[mon], int(d))


def money(s):
    """'$88,998' -> 88998.0 ; '-' (no winner) -> None."""
    s = (s or "").strip()
    if not s or s in {"-", "--", "–"}:
        return None
    cleaned = re.sub(r"[^\d.]", "", s)
    return float(cleaned) if cleaned else None


def header(body, what):
    """The date/draw-number header every game shares."""
    date = iso_date(text_of(one(r"<th[^>]*class='drawDate'[^>]*>(.*?)</th>", body, what + " date")))
    draw = int(re.sub(r"\D", "", text_of(
        one(r"<th[^>]*class='drawNumber'[^>]*>(.*?)</th>", body, what + " number"))))
    return date, draw


# ---------------------------------------------------------------- parsers

def parse_4d(body):
    date, draw = header(body, "4D")

    def prize(cls):
        return text_of(one(r"<td[^>]*class='%s'[^>]*>(.*?)</td>" % cls, body, "4D " + cls))

    def block(cls):
        chunk = one(r"<tbody[^>]*class='%s'[^>]*>(.*?)</tbody>" % cls, body, "4D " + cls)
        return [text_of(td) for td in find_all(r"<td[^>]*>(.*?)</td>", chunk)
                if re.fullmatch(r"\d{4}", text_of(td))]

    return {
        "draw": draw, "date": date,
        "first": prize("tdFirstPrize"),
        "second": prize("tdSecondPrize"),
        "third": prize("tdThirdPrize"),
        "starter": block("tbodyStarterPrizes"),
        "consolation": block("tbodyConsolationPrizes"),
    }


def parse_toto(body):
    date, draw = header(body, "TOTO")

    numbers = []
    for i in range(1, 7):
        numbers.append(int(text_of(
            one(r"<td[^>]*class='win%d'[^>]*>(.*?)</td>" % i, body, "TOTO win%d" % i))))
    additional = int(text_of(
        one(r"<td[^>]*class='additional'[^>]*>(.*?)</td>", body, "TOTO additional")))

    jackpot = money(text_of(maybe(r"<td[^>]*class='jackpotPrize'[^>]*>(.*?)</td>", body) or ""))

    # Winning-shares table: the only one whose rows read "Group N | amount | shares".
    groups = []
    for table in find_all(r"<table[^>]*>.*?</table>", body):
        parsed = []
        for row in find_all(r"<tr[^>]*>(.*?)</tr>", table):
            cells = [text_of(c) for c in find_all(r"<t[dh][^>]*>(.*?)</t[dh]>", row)]
            if len(cells) >= 3 and re.fullmatch(r"Group\s*[1-7]", cells[0]):
                shares = money(cells[2])
                parsed.append({
                    "group": int(re.sub(r"\D", "", cells[0])),
                    "prize": money(cells[1]),
                    "shares": int(shares) if shares is not None else 0,
                })
        if len(parsed) >= 5:            # a real prize table has all seven groups
            groups = parsed
            break

    return {
        "draw": draw, "date": date,
        "numbers": sorted(numbers),
        "additional": additional,
        "jackpot": jackpot,
        "groups": groups,
    }


# "10 Jackpot Prizes @ $10,000 each" / "315,000 2D Delight Prizes @ $6 each"
SWEEP_HEADING = re.compile(
    r"^([\d,]+)\s+(.*?)\s+Prizes?\s*@\s*\$?([\d,]+)", re.I)


def sweep_ticket(s):
    """'258 9838' and '2589838' are the same ticket; store it unspaced."""
    return re.sub(r"\D", "", s)


# Prize numbers live one per <li> (mobile layout) or one per <td> (desktop).
# Reading them from the elements, rather than from the chunk's flattened text,
# is what keeps a neighbouring draw date out of the list: "Wed, 07 Oct 2026"
# sitting after the last group used to contribute a phantom "07" to 2D Delight.
SWEEP_CELL = re.compile(r"<(?:li|td)[^>]*>(.*?)</(?:li|td)>", re.S)


def parse_sweep(body):
    date, draw = header(body, "Sweep")

    def top(cls):
        return sweep_ticket(text_of(
            one(r"class='%s'[^>]*>(.*?)</" % cls, body, "Sweep " + cls)))

    groups = []
    seen = set()
    # Each draw is rendered twice, once for mobile and once for desktop. Same
    # content, so keep the first of each heading and drop the repeat.
    for m in re.finditer(
            r"class='prizeGroupHeading'[^>]*>(.*?)</[^>]+>(.*?)(?=class='prizeGroupHeading'|\Z)",
            body, re.S):
        heading = text_of(m.group(1))
        if not heading or heading in seen:
            continue
        hm = SWEEP_HEADING.match(heading)
        if not hm:
            continue
        seen.add(heading)
        count = int(hm.group(1).replace(",", ""))
        label = hm.group(2).strip()
        amount = float(hm.group(3).replace(",", ""))

        cells = [text_of(c) for c in SWEEP_CELL.findall(m.group(2))]
        if "2D" in label:
            nums = [c for c in cells if re.fullmatch(r"\d{2}", c)]
        else:
            nums = [sweep_ticket(c) for c in cells if re.fullmatch(r"\d{3}\s?\d{4}", c)]
            # The heading states how many there should be, so a mismatch means
            # the markup moved and we are silently losing or inventing winners.
            if len(nums) != count:
                raise RuntimeError(
                    "Sweep draw %d, %s: heading says %d numbers, found %d"
                    % (draw, label, count, len(nums)))
        groups.append({"label": label, "count": count, "amount": amount, "numbers": nums})

    if not groups:
        raise RuntimeError("Sweep draw %d: no prize groups parsed" % draw)

    return {
        "draw": draw, "date": date,
        "first": top("valueFirstPrize"),
        "second": top("valueSecondPrize"),
        "third": top("valueThirdPrize"),
        "groups": groups,
    }


def split_li(body):
    """4D and TOTO top-draws: one <li> per draw, each self-contained."""
    return [c for c in body.split("<li>") if "drawNumber" in c]


def split_sweep(body):
    """
    Sweep top-draws carries THREE draws, not one, and renders each twice - a
    mobile block of expandable lists followed by a desktop tables-wrap. Both
    carry the full prize detail, so slicing on tables-wrap gives one complete,
    self-contained chunk per draw.

    Getting this wrong is quiet rather than loud: the old split returned the
    whole document as a single draw, so the two older draws never arrived from
    this file and only turned up later via the per-draw backfill.
    """
    # Keep only the desktop blocks. Both layouts carry the same draw, but the
    # mobile one labels the date with <span class='drawDate'> and the desktop
    # one with <th>, so matching the <th> form selects exactly one chunk per
    # draw and drops the mobile duplicate that precedes the first tables-wrap.
    # Testing for the bare string "drawDate" is not enough - it matches both,
    # and the mobile chunk then fails to parse and warns on every single run.
    desktop = re.compile(r"<th[^>]*class='drawDate'")
    chunks = [c for c in re.split(r"(?=<div class='tables-wrap)", body) if desktop.search(c)]
    return chunks or ([body] if desktop.search(body) else [])


GAMES = {
    "fourd": {
        "name": "4D",
        "top": ARCHIVE + "fourd_result_top_draws_en.html",
        "list": ARCHIVE + "fourd_result_draw_list_en.html",
        "page": PAGES + "4d_results.aspx?sppl=",
        "split": split_li,
        "parse": parse_4d,
    },
    "toto": {
        "name": "TOTO",
        "top": ARCHIVE + "toto_result_top_draws_en.html",
        "list": ARCHIVE + "toto_result_draw_list_en.html",
        "page": PAGES + "toto_results.aspx?sppl=",
        "split": split_li,
        "parse": parse_toto,
    },
    "sweep": {
        "name": "Sweep",
        "top": ARCHIVE + "sweep_result_top_draws_en.html",
        "list": ARCHIVE + "sweep_result_draw_list_en.html",
        "page": PAGES + "sweep_results.aspx?sppl=",
        "split": split_sweep,
        "parse": parse_sweep,
    },
}


def parse_draw_list(body):
    """[(draw_number, sppl, cancelled)] newest first."""
    out = []
    for opt in find_all(r"<option[^>]*>[^<]*</option>", body):
        num = re.search(r"value='(\d+)'", opt)
        qs = re.search(r"queryString='sppl=([^']+)'", opt)
        if not (num and qs):
            continue
        out.append((int(num.group(1)), qs.group(1), bool(re.search(r"isCancelled='(?!')", opt))))
    if not out:
        raise RuntimeError("draw list parsed to nothing; the <select> markup changed")
    return out


def sppl_for(draw_number):
    """The site's own encoding, reproduced so we can request a draw by number."""
    return base64.b64encode(("DrawNumber=%d" % draw_number).encode()).decode()


# ---------------------------------------------------------------- driver

def scrape_game(key, limit, known):
    """New draws from the cheap top-draws file, then backfill within `limit`."""
    g = GAMES[key]
    out = []

    body, final = fetch(g["top"])
    assert_looks_like_results(body, final, g["name"] + " top-draws")
    for chunk in g["split"](body):
        try:
            rec = g["parse"](chunk)
        except RuntimeError as e:
            print("  WARN %s top-draws chunk: %s" % (g["name"], e), file=sys.stderr)
            continue
        if rec["draw"] not in known:
            out.append(rec)
            known.add(rec["draw"])
    if out:
        print("  %s: %d new from top-draws" % (g["name"], len(out)), file=sys.stderr)

    # Backfill older history with whatever budget is left.
    budget = limit - len(out)
    if budget <= 0:
        return out

    listing, _ = fetch(g["list"])
    wanted = []
    for number, sppl, cancelled in parse_draw_list(listing):
        if len(wanted) >= budget:
            break
        if number in known:
            continue
        if cancelled:
            print("  skip %s draw %d (cancelled)" % (g["name"], number), file=sys.stderr)
            continue
        wanted.append((number, sppl))

    for i, (number, sppl) in enumerate(wanted, 1):
        time.sleep(DELAY_S)
        page, final = fetch(g["page"] + sppl)
        assert_looks_like_results(page, final, "%s draw %d" % (g["name"], number))
        try:
            out.append(g["parse"](page))
        except RuntimeError as e:
            # One malformed draw must not sink a backfill of hundreds.
            print("  WARN %s draw %d: %s" % (g["name"], number, e), file=sys.stderr)
        if i % 25 == 0 or i == len(wanted):
            print("  %s backfill %d/%d" % (g["name"], i, len(wanted)), file=sys.stderr)
    return out


def merge(existing, fresh):
    by_draw = {d["draw"]: d for d in existing}
    by_draw.update({d["draw"]: d for d in fresh})
    return sorted(by_draw.values(), key=lambda d: d["draw"], reverse=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="data/history.json")
    ap.add_argument("--limit", type=int, default=5,
                    help="max NEW draws per game (default 5, the incremental cron case)")
    ap.add_argument("--backfill", type=int, metavar="N",
                    help="shorthand for --limit N on a cold start")
    ap.add_argument("--games", default="fourd,toto,sweep",
                    help="comma-separated subset of: fourd, toto, sweep")
    args = ap.parse_args()
    if args.backfill:
        args.limit = args.backfill

    prev = {}
    if os.path.exists(args.out):
        with open(args.out, encoding="utf-8") as f:
            prev = json.load(f)

    payload = {
        "generated": datetime.now(SGT).isoformat(timespec="seconds"),
        "source": "singaporepools.com.sg",
    }

    for key in GAMES:
        held = prev.get(key, [])
        if key not in [g.strip() for g in args.games.split(",")]:
            payload[key] = held               # untouched, but never dropped
            continue
        known = {d["draw"] for d in held}
        payload[key] = merge(held, scrape_game(key, args.limit, known))

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    print("wrote %s" % args.out)
    for key, g in GAMES.items():
        rows = payload.get(key, [])
        if rows:
            print("  %-6s %4d draws, newest %s draw %s" % (
                g["name"], len(rows), rows[0]["date"], rows[0]["draw"]))
        else:
            print("  %-6s none" % g["name"])


if __name__ == "__main__":
    main()
