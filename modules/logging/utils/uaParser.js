// ============================================================
// FILE: uaParser.js
// PURPOSE: Lightweight user-agent parser — extracts browser and OS
//          without heavy 400KB+ dependencies like ua-parser-js.
// CONNECTS TO: securityLogger.js, requestLogger.js
// ============================================================

/**
 * Browser detection patterns — order matters (first match wins).
 * WHY regex over library: 15 lines vs 400KB dependency, <0.1ms per parse.
 * @type {Array<[RegExp, string]>}
 */
const BROWSER_PATTERNS = [
  [/Edg(?:e|A)?\/(\d+)/i,    'Edge'],
  [/OPR\/(\d+)/i,            'Opera'],
  [/Chrome\/(\d+)/i,         'Chrome'],
  [/Firefox\/(\d+)/i,        'Firefox'],
  [/Safari\/(\d+)/i,         'Safari'],
  [/MSIE\s(\d+)/i,           'IE'],
  [/Trident.*rv:(\d+)/i,     'IE'],
];

/**
 * OS detection patterns.
 * @type {Array<[RegExp, string]>}
 */
const OS_PATTERNS = [
  [/Windows NT 10/i,          'Windows'],
  [/Windows NT/i,             'Windows'],
  [/Mac OS X/i,               'macOS'],
  [/Android/i,                'Android'],
  [/iPhone|iPad|iPod/i,       'iOS'],
  [/Linux/i,                  'Linux'],
  [/CrOS/i,                   'ChromeOS'],
];

/**
 * Parse a user-agent string into a readable browser + OS summary.
 *
 * @param {string|null|undefined} ua — Raw User-Agent header value
 * @returns {{ browser: string, os: string, raw: string }}
 *
 * @example
 * parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0')
 * // → { browser: 'Chrome 120', os: 'Windows', raw: '...' }
 */
export function parseUserAgent(ua) {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', raw: '' };

  let browser = 'Unknown';
  for (const [pattern, name] of BROWSER_PATTERNS) {
    const match = ua.match(pattern);
    if (match) {
      browser = match[1] ? `${name} ${match[1]}` : name;
      break;
    }
  }

  let os = 'Unknown';
  for (const [pattern, name] of OS_PATTERNS) {
    if (pattern.test(ua)) {
      os = name;
      break;
    }
  }

  return { browser, os, raw: ua };
}
