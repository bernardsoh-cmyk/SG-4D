/*
 * SG 4D — prize matching.
 *
 * Every number in here is transcribed from Singapore Pools' own published 4D
 * Game Rules (cl. 4.5), not from memory and not inferred from results pages.
 *
 * 4D pays FIXED amounts per $1 stake, so unlike a pari-mutuel game a win can be
 * computed exactly from the winning numbers alone. That is what makes this
 * checker worth having: the figures it shows are the real figures, not
 * estimates.
 */
window.SGCheck = (function () {
  'use strict';

  /* 4D Game Rules cl. 4.5 — Ordinary, 4D Roll and System Entry, per $1 stake. */
  var FOURD_FIXED = {
    big:   { first: 2000, second: 1000, third: 490, starter: 250, consolation: 60 },
    small: { first: 3000, second: 2000, third: 800, starter: 0,   consolation: 0 }
  };

  /* iBet pays less, and how much less depends on how many permutations the
   * number has — which is why this is a matrix and not a division. Columns are
   * the four digit patterns named in the rules. */
  var IBET_PATTERNS = ['allDifferent', 'onePair', 'twoPairs', 'threeSame'];
  var FOURD_IBET = {
    big: {
      first:       [83, 166, 335, 500],
      second:      [41,  83, 168, 250],
      third:       [20,  40,  85, 127],
      starter:     [10,  20,  41,  62],
      consolation: [ 3,   6,  10,  15]
    },
    small: {
      first:  [125, 250, 500, 750],
      second: [ 83, 167, 333, 500],
      third:  [ 33,  66, 133, 200],
      starter: [0, 0, 0, 0],
      consolation: [0, 0, 0, 0]
    }
  };

  var CATEGORIES = ['first', 'second', 'third', 'starter', 'consolation'];
  var CATEGORY_LABEL = {
    first: '1st Prize', second: '2nd Prize', third: '3rd Prize',
    starter: 'Starter', consolation: 'Consolation'
  };

  /** 'allDifferent' | 'onePair' | 'twoPairs' | 'threeSame' | 'allSame'. */
  function digitPattern(num) {
    var counts = {};
    String(num).split('').forEach(function (d) { counts[d] = (counts[d] || 0) + 1; });
    var shape = Object.keys(counts).map(function (k) { return counts[k]; })
                      .sort(function (a, b) { return b - a; }).join('');
    if (shape === '1111') return 'allDifferent';
    if (shape === '211') return 'onePair';
    if (shape === '22') return 'twoPairs';
    if (shape === '31') return 'threeSame';
    return 'allSame';
  }

  /** Distinct permutations of a 4-digit number: 24 / 12 / 6 / 4 / 1. */
  function permutationCount(num) {
    return { allDifferent: 24, onePair: 12, twoPairs: 6, threeSame: 4, allSame: 1 }[digitPattern(num)];
  }

  /** Every distinct arrangement of a 4-digit number, as zero-padded strings. */
  function permutations(num) {
    var digits = String(num).split('');
    var seen = {};
    (function recurse(prefix, rest) {
      if (!rest.length) { seen[prefix] = true; return; }
      for (var i = 0; i < rest.length; i++) {
        recurse(prefix + rest[i], rest.slice(0, i).concat(rest.slice(i + 1)));
      }
    })('', digits);
    return Object.keys(seen);
  }

  /** The ten numbers a 4D Roll covers, e.g. '58R2' or '58x2' -> 5802..5892. */
  function rollNumbers(pattern) {
    var s = String(pattern).toUpperCase();
    // Exactly one rolling slot; the other three must be digits.
    if (!/^[\dRX?]{4}$/.test(s) || (s.match(/[RX?]/g) || []).length !== 1) return null;
    var slot = s.search(/[RX?]/);
    var out = [];
    for (var d = 0; d <= 9; d++) out.push(s.slice(0, slot) + d + s.slice(slot + 1));
    return out;
  }

  /** Which prize categories `number` hits in `draw`, with how many hits each. */
  function hitsIn(number, draw) {
    var n = String(number);
    var hits = {};
    if (draw.first === n) hits.first = 1;
    if (draw.second === n) hits.second = 1;
    if (draw.third === n) hits.third = 1;
    var starter = (draw.starter || []).filter(function (x) { return x === n; }).length;
    var consol = (draw.consolation || []).filter(function (x) { return x === n; }).length;
    if (starter) hits.starter = starter;
    if (consol) hits.consolation = consol;
    return hits;
  }

  /**
   * Check one 4D bet against one draw.
   *
   *   entry  '1234', or '12R4' / '12x4' for a Roll
   *   type   'ordinary' | 'ibet' | 'system' | 'roll'
   *   size   'big' | 'small'
   *   stake  dollars per number (the unit stake, as printed on a ticket)
   *
   * Returns { total, unitsStaked, lines: [...] }. `lines` is one row per prize
   * actually hit, ready to render. Rule 4.6: a number that hits more than one
   * category collects all of them, so these add rather than replace.
   */
  function checkFourD(entry, type, size, stake, draw) {
    stake = stake || 1;
    var table = FOURD_FIXED[size];
    var ibet = FOURD_IBET[size];
    var lines = [];
    var total = 0;

    // Which numbers does this entry actually cover, and what does each cost?
    var numbers;
    if (type === 'roll') {
      numbers = rollNumbers(entry);
      if (!numbers) return { error: 'A 4D Roll needs one rolling digit, e.g. 58R2.' };
    } else if (type === 'system') {
      if (!/^\d{4}$/.test(String(entry))) return { error: 'Enter a 4-digit number from 0000 to 9999.' };
      if (digitPattern(entry) === 'allSame') {
        return { error: 'A number with four identical digits has only one permutation, so it cannot be a System Entry.' };
      }
      numbers = permutations(entry);
    } else {
      if (!/^\d{4}$/.test(String(entry))) return { error: 'Enter a 4-digit number from 0000 to 9999.' };
      numbers = [String(entry)];
    }

    if (type === 'ibet') {
      // One stake spread across every permutation, paying the iBet matrix.
      var pattern = digitPattern(entry);
      if (pattern === 'allSame') {
        return { error: 'A number with four identical digits has only one permutation, so it cannot be an iBet.' };
      }
      var col = IBET_PATTERNS.indexOf(pattern);
      var perms = permutations(entry);
      CATEGORIES.forEach(function (cat) {
        var count = perms.reduce(function (acc, p) { return acc + (hitsIn(p, draw)[cat] || 0); }, 0);
        if (!count) return;
        var per = ibet[cat][col] * stake;
        if (!per) return;                       // Small has no Starter/Consolation
        total += per * count;
        lines.push({
          category: CATEGORY_LABEL[cat], count: count,
          per: per, amount: per * count
        });
      });
      return {
        total: total, unitsStaked: 1, stake: stake,
        pattern: pattern, permutations: perms.length, lines: lines
      };
    }

    // Ordinary / Roll / System: every covered number is a full unit stake at
    // the fixed table, which is also why they cost more to place.
    CATEGORIES.forEach(function (cat) {
      var count = numbers.reduce(function (acc, n) { return acc + (hitsIn(n, draw)[cat] || 0); }, 0);
      if (!count) return;
      var per = table[cat] * stake;
      if (!per) return;
      total += per * count;
      lines.push({
        category: CATEGORY_LABEL[cat], count: count,
        per: per, amount: per * count
      });
    });

    return {
      total: total,
      unitsStaked: numbers.length,
      stake: stake,
      cost: numbers.length * stake,
      numbers: numbers,
      lines: lines
    };
  }

  return {
    checkFourD: checkFourD,
    digitPattern: digitPattern,
    permutationCount: permutationCount,
    permutations: permutations,
    rollNumbers: rollNumbers,
    hitsIn: hitsIn,
    FOURD_FIXED: FOURD_FIXED,
    FOURD_IBET: FOURD_IBET
  };
})();
