/*
 * SG 4D — frequency statistics.
 *
 * Read this before you read anything below it:
 *
 *   Draws are independent. A number that has not appeared for forty draws is
 *   exactly as likely to appear tonight as one that came up yesterday. Nothing
 *   computed in this file predicts anything, and the UI says so on every screen
 *   that renders it.
 *
 * What it is for, then: these are the numbers people actually want to look at,
 * and they are genuinely interesting as a description of what has happened. So
 * the arithmetic is honest — real counts over a stated window, with the
 * expected count shown alongside the observed one, so a "hot" digit is visibly
 * only a few appearances away from average rather than looking like a signal.
 */
window.SGStats = (function () {
  'use strict';

  function zeros(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = 0; return a; }

  /** Every 4-digit number a draw produced: 3 prizes + 10 starters + 10 consolations. */
  function allNumbers(draw) {
    return [draw.first, draw.second, draw.third]
      .concat(draw.starter || [], draw.consolation || [])
      .filter(Boolean);
  }

  /** Just the top three, for people who only count "real" wins. */
  function topNumbers(draw) {
    return [draw.first, draw.second, draw.third].filter(Boolean);
  }

  /**
   * Digit frequency by position across `draws`.
   * Returns positions[0..3][digit 0..9] plus an overall tally and the expected
   * count per cell, so the UI can show observed against expected.
   */
  function digitFrequency(draws, scope) {
    var pick = scope === 'top' ? topNumbers : allNumbers;
    var positions = [zeros(10), zeros(10), zeros(10), zeros(10)];
    var overall = zeros(10);
    var numberCount = 0;

    draws.forEach(function (d) {
      pick(d).forEach(function (n) {
        numberCount++;
        for (var p = 0; p < 4; p++) {
          var digit = parseInt(n.charAt(p), 10);
          positions[p][digit]++;
          overall[digit]++;
        }
      });
    });

    return {
      positions: positions,
      overall: overall,
      numberCount: numberCount,
      expectedPerPosition: numberCount / 10,
      expectedOverall: (numberCount * 4) / 10
    };
  }

  /**
   * How often each full 4-digit number has appeared, and how many draws ago it
   * last did. Only numbers that have actually appeared are returned — the other
   * ~9,000 are all tied at zero and listing them is noise.
   */
  function numberTally(draws, scope) {
    var pick = scope === 'top' ? topNumbers : allNumbers;
    var seen = {};
    draws.forEach(function (d, index) {          // draws arrive newest-first
      pick(d).forEach(function (n) {
        if (!seen[n]) seen[n] = { number: n, count: 0, lastIndex: index, lastDate: d.date };
        seen[n].count++;
        if (index < seen[n].lastIndex) {
          seen[n].lastIndex = index;
          seen[n].lastDate = d.date;
        }
      });
    });
    return Object.keys(seen).map(function (k) { return seen[k]; });
  }

  /** Draws since `number` last appeared, or null if it never has in this window. */
  function drawsSince(draws, number, scope) {
    var pick = scope === 'top' ? topNumbers : allNumbers;
    for (var i = 0; i < draws.length; i++) {
      if (pick(draws[i]).indexOf(String(number)) !== -1) return i;
    }
    return null;
  }

  /** Every past appearance of one number, newest first. */
  function appearances(draws, number) {
    var n = String(number);
    var out = [];
    draws.forEach(function (d) {
      var where = [];
      if (d.first === n) where.push('1st Prize');
      if (d.second === n) where.push('2nd Prize');
      if (d.third === n) where.push('3rd Prize');
      (d.starter || []).forEach(function (x) { if (x === n) where.push('Starter'); });
      (d.consolation || []).forEach(function (x) { if (x === n) where.push('Consolation'); });
      if (where.length) out.push({ draw: d.draw, date: d.date, where: where });
    });
    return out;
  }

  /* A random pick. Entertainment, and labelled as such where it is used — it is
   * not smarter than any other four digits. */
  function randomFourD() {
    var s = '';
    for (var i = 0; i < 4; i++) s += Math.floor(Math.random() * 10);
    return s;
  }

  /* ------------------------------- TOTO -------------------------------
   *
   * Singapore Sweep gets nothing here on purpose. Its tickets are issued in
   * sequence rather than drawn from a pool, so "frequent numbers" would be a
   * statistic about which serials happen to have been printed, which tells
   * you nothing at all. Inventing one would be worse than leaving it out. */

  /**
   * Ball frequency over `draws`.
   *
   * `expected` is the honest yardstick: six of 49 balls are drawn, so each
   * should appear draws * 6/49 times. Showing that beside the count is the
   * difference between a statistic and a superstition.
   */
  function ballFrequency(draws, includeAdditional) {
    var counts = zeros(50), lastSeen = new Array(50);
    draws.forEach(function (d, index) {
      var balls = d.numbers.slice();
      if (includeAdditional && d.additional) balls.push(d.additional);
      balls.forEach(function (n) {
        counts[n]++;
        if (lastSeen[n] === undefined) lastSeen[n] = index;
      });
    });
    var out = [];
    for (var n = 1; n <= 49; n++) {
      out.push({
        number: n, count: counts[n],
        drawsSince: lastSeen[n] === undefined ? null : lastSeen[n],
        lastDate: lastSeen[n] === undefined ? null : draws[lastSeen[n]].date
      });
    }
    return {
      balls: out,
      expected: draws.length * (includeAdditional ? 7 : 6) / 49,
      drawCount: draws.length
    };
  }

  /** Shape of the winning sets: odd/even, low/high, and the sum. */
  function shapeStats(draws) {
    var oddSplit = zeros(7), lowSplit = zeros(7), sums = [];
    draws.forEach(function (d) {
      var odd = 0, low = 0, sum = 0;
      d.numbers.forEach(function (n) {
        if (n % 2) odd++;
        if (n <= 24) low++;
        sum += n;
      });
      oddSplit[odd]++; lowSplit[low]++; sums.push(sum);
    });
    sums.sort(function (a, b) { return a - b; });
    return {
      oddSplit: oddSplit, lowSplit: lowSplit,
      sumMin: sums[0], sumMax: sums[sums.length - 1],
      sumMedian: sums.length ? sums[Math.floor(sums.length / 2)] : null
    };
  }

  /** How often each prize group was actually won, and its biggest share. */
  function groupHistory(draws) {
    var out = {};
    for (var g = 1; g <= 7; g++) out[g] = { group: g, drawsWon: 0, biggestShare: null };
    draws.forEach(function (d) {
      (d.groups || []).forEach(function (row) {
        var slot = out[row.group];
        if (!slot) return;
        if (row.shares > 0) slot.drawsWon++;
        if (row.prize !== null && (slot.biggestShare === null || row.prize > slot.biggestShare)) {
          slot.biggestShare = row.prize;
        }
      });
    });
    return Object.keys(out).map(function (k) { return out[k]; });
  }

  function randomToto(count) {
    var pool = [];
    for (var n = 1; n <= 49; n++) pool.push(n);
    var out = [];
    for (var i = 0; i < (count || 6); i++) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  return {
    allNumbers: allNumbers,
    topNumbers: topNumbers,
    digitFrequency: digitFrequency,
    numberTally: numberTally,
    drawsSince: drawsSince,
    appearances: appearances,
    randomFourD: randomFourD,
    ballFrequency: ballFrequency,
    shapeStats: shapeStats,
    groupHistory: groupHistory,
    randomToto: randomToto
  };
})();
