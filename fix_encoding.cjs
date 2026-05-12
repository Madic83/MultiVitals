const fs = require('fs');
const f = 'c:/Sim/src/App.tsx';
let c = fs.readFileSync(f, 'utf8');

// Each garbled sequence is the Win-1252 reinterpretation of the original UTF-8 bytes,
// re-saved as UTF-8. We map the resulting Unicode codepoints back to the intended char.
const fixes = [
  // Swedish vowels (safe to repeat)
  ['\u00c3\u00b6', '\u00f6'], // ö
  ['\u00c3\u00a5', '\u00e5'], // å
  ['\u00c3\u00a4', '\u00e4'], // ä
  ['\u00c3\u0096', '\u00d6'], // Ö
  ['\u00c3\u0085', '\u00c5'], // Å
  ['\u00c3\u0084', '\u00c4'], // Ä
  ['\u00c3\u00a9', '\u00e9'], // é
  ['\u00c2\u00b0', '\u00b0'], // °

  // Em dash — (U+2014): bytes E2 80 94 -> â€" = [U+00E2, U+20AC, U+201D]
  ['\u00e2\u20ac\u201d', '\u2014'],

  // Minus sign − (U+2212): bytes E2 88 92 -> âˆ' = [U+00E2, U+02C6, U+2019]
  ['\u00e2\u02c6\u2019', '\u2212'],

  // Star ★ (U+2605): bytes E2 98 85 -> â˜… = [U+00E2, U+02DC, U+2026]
  ['\u00e2\u02dc\u2026', '\u2605'],

  // ✕ (U+2715): bytes E2 9C 95 -> âœ• = [U+00E2, U+0153, U+2022]
  ['\u00e2\u0153\u2022', '\u2715'],

  // ✓ (U+2713): bytes E2 9C 93 -> âœ" = [U+00E2, U+0153, U+201C]
  ['\u00e2\u0153\u201c', '\u2713'],

  // ▸ (U+25B8): bytes E2 96 B8 -> â–¸ = [U+00E2, U+2013, U+00B8]
  ['\u00e2\u2013\u00b8', '\u25b8'],

  // ♦ (U+2666): bytes E2 99 A6 -> â™¦ = [U+00E2, U+2122, U+00A6]
  ['\u00e2\u2122\u00a6', '\u2666'],

  // ❄ snowflake (U+2744) - mangled middle byte: â„ = [U+00E2, U+201E]
  ['\u00e2\u201e', '\u2744'],

  // 🔔 bell (U+1F514): bytes F0 9F 94 94 -> ðŸ"" = [U+00F0, U+0178, U+201D, U+201D]
  ['\u00f0\u0178\u201d\u201d', '\uD83D\uDD14'],

  // 🔇 mute (U+1F507): bytes F0 9F 94 87 -> ðŸ"‡ = [U+00F0, U+0178, U+201D, U+2021]
  ['\u00f0\u0178\u201d\u2021', '\uD83D\uDD07'],

  // Right single quote ' (U+2019): bytes E2 80 99 -> â€™ = [U+00E2, U+20AC, U+2122]
  ['\u00e2\u20ac\u2122', '\u2019'],

  // En dash – (U+2013): bytes E2 80 93 -> [U+00E2, U+20AC, U+201C]  (must run AFTER block-graphic fixes)
  ['\u00e2\u20ac\u201c', '\u2013'],

  // Bullet • (U+2022): bytes E2 80 A2 -> [U+00E2, U+20AC, U+00A2]
  ['\u00e2\u20ac\u00a2', '\u2022'],

  // Block/geometric chars — byte 96 in Win-1252 = – (U+2013), so sequence is [U+00E2, U+2013, Xn]
  // ▲ (U+25B2): E2 96 B2 -> [U+00E2, U+2013, U+00B2]
  ['\u00e2\u2013\u00b2', '\u25b2'],
  // ▱ (U+25B1): E2 96 B1 -> [U+00E2, U+2013, U+00B1]
  ['\u00e2\u2013\u00b1', '\u25b1'],
  // ▵ (U+25B3): E2 96 B3 -> [U+00E2, U+2013, U+00B3]
  ['\u00e2\u2013\u00b3', '\u25b3'],
  // ▣ (U+25A3): E2 96 A3 -> [U+00E2, U+2013, U+00A3]
  ['\u00e2\u2013\u00a3', '\u25a3'],
  // ▦ (U+25A6): E2 96 A6 -> [U+00E2, U+2013, U+00A6]
  ['\u00e2\u2013\u00a6', '\u25a6'],

  // ∿ (U+223F): E2 88 BF -> [U+00E2, U+02C6, U+00BF]
  ['\u00e2\u02c6\u00bf', '\u223f'],

  // ⌂ (U+2302): E2 8C 82 -> [U+00E2, U+0152, U+201A]
  ['\u00e2\u0152\u201a', '\u2302'],

  // ♂ (U+2642): E2 99 82 -> [U+00E2, U+2122, U+201A]
  ['\u00e2\u2122\u201a', '\u2642'],
  // ♀ (U+2640): E2 99 80 -> [U+00E2, U+2122, U+20AC]
  ['\u00e2\u2122\u20ac', '\u2640'],

  // 🖨 printer emoji (U+1F5A8): F0 9F 96 A8 -> [U+00F0, U+0178, U+2013, U+00A8]
  ['\u00f0\u0178\u2013\u00a8', '\uD83D\uDDA8'],
];

let count = 0;
for (const [bad, good] of fixes) {
  const before = c;
  c = c.split(bad).join(good);
  if (c !== before) { console.log('Fixed:', JSON.stringify(bad), '->',  JSON.stringify(good)); count++; }
}
fs.writeFileSync(f, c, 'utf8');
console.log('Total fixed:', count, 'patterns. File length:', c.length);
