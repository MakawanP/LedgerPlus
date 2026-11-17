/**
 * Automated merchant-to-domain resolution & brand monogram utilities
 * for fetching company favicons/logos alongside transaction ledger rows.
 */

export interface ResolvedMerchantBrand {
  domain: string | null;
  logoEndpointUrl: string | null;
  monogram: string;
  fallbackKind: 'brand' | 'income' | 'transfer' | 'cash';
  tintClass: string;
}

const KNOWN_MERCHANT_DOMAINS: Array<{ pattern: RegExp; domain: string }> = [
  { pattern: /\bblue\s*bottle/i, domain: 'bluebottlecoffee.com' },
  { pattern: /\bphilz/i, domain: 'philzcoffee.com' },
  { pattern: /\bsightglass/i, domain: 'sightglasscoffee.com' },
  { pattern: /\btartine/i, domain: 'tartinebakery.com' },
  { pattern: /\bstarbucks/i, domain: 'starbucks.com' },
  { pattern: /\bdunkin/i, domain: 'dunkindonuts.com' },
  { pattern: /\bpeet'?s/i, domain: 'peets.com' },
  { pattern: /\buber\b/i, domain: 'uber.com' },
  { pattern: /\blyft\b/i, domain: 'lyft.com' },
  { pattern: /\bwaymo\b/i, domain: 'waymo.com' },
  { pattern: /\bdoordash/i, domain: 'doordash.com' },
  { pattern: /\binstacart/i, domain: 'instacart.com' },
  { pattern: /\bgrubhub/i, domain: 'grubhub.com' },
  { pattern: /\bwhole\s*foods|\bwholefds/i, domain: 'wholefoodsmarket.com' },
  { pattern: /\btrader\s*joe/i, domain: 'traderjoes.com' },
  { pattern: /\bcostco/i, domain: 'costco.com' },
  { pattern: /\bsafeway/i, domain: 'safeway.com' },
  { pattern: /\bkroger/i, domain: 'kroger.com' },
  { pattern: /\btarget\b/i, domain: 'target.com' },
  { pattern: /\bwalmart/i, domain: 'walmart.com' },
  { pattern: /\bamazon|\bamzn\b/i, domain: 'amazon.com' },
  { pattern: /\bsweetgreen/i, domain: 'sweetgreen.com' },
  { pattern: /\bchipotle/i, domain: 'chipotle.com' },
  { pattern: /\bcava\b/i, domain: 'cava.com' },
  { pattern: /\bshake\s*shack/i, domain: 'shakeshack.com' },
  { pattern: /\bosteria\s*mozza/i, domain: 'osteriamozza.com' },
  { pattern: /\bshell\b/i, domain: 'shell.com' },
  { pattern: /\bchevron/i, domain: 'chevron.com' },
  { pattern: /\bexxon/i, domain: 'exxon.com' },
  { pattern: /\bj\.?\s*crew/i, domain: 'jcrew.com' },
  { pattern: /\bvenmo/i, domain: 'venmo.com' },
  { pattern: /\bpaypal/i, domain: 'paypal.com' },
  { pattern: /\bzelle/i, domain: 'zellepay.com' },
  { pattern: /\bdelta(\s+air)?/i, domain: 'delta.com' },
  { pattern: /\bunited(\s+air)?/i, domain: 'united.com' },
  { pattern: /\bamerican\s+air/i, domain: 'aa.com' },
  { pattern: /\bsouthwest/i, domain: 'southwest.com' },
  { pattern: /\bairbnb/i, domain: 'airbnb.com' },
  { pattern: /\bmarriott/i, domain: 'marriott.com' },
  { pattern: /\bhilton/i, domain: 'hilton.com' },
  { pattern: /\bchase\b/i, domain: 'chase.com' },
  { pattern: /\bamex|\bamerican\s*express/i, domain: 'americanexpress.com' },
  { pattern: /\bmarcus\b/i, domain: 'marcus.com' },
  { pattern: /\bfidelity/i, domain: 'fidelity.com' },
  { pattern: /\bschwab/i, domain: 'schwab.com' },
  { pattern: /\baesop/i, domain: 'aesop.com' },
  { pattern: /\bsephora/i, domain: 'sephora.com' },
  { pattern: /\bulta\b/i, domain: 'ulta.com' },
  { pattern: /\bamc\b/i, domain: 'amctheatres.com' },
  { pattern: /\bpg&e|\bpge\b/i, domain: 'pge.com' },
  { pattern: /\bsonic\b/i, domain: 'sonic.com' },
  { pattern: /\bat&t|\batt\b/i, domain: 'att.com' },
  { pattern: /\bverizon/i, domain: 'verizon.com' },
  { pattern: /\bt-mobile|\btmobile/i, domain: 't-mobile.com' },
  { pattern: /\bcomcast|\bxfinity/i, domain: 'xfinity.com' },
  { pattern: /\bequinox/i, domain: 'equinox.com' },
  { pattern: /\bpeloton/i, domain: 'onepeloton.com' },
  { pattern: /\bcoursera/i, domain: 'coursera.org' },
  { pattern: /\budemy/i, domain: 'udemy.com' },
  { pattern: /\badobe/i, domain: 'adobe.com' },
  { pattern: /\bfigma/i, domain: 'figma.com' },
  { pattern: /\bnotion/i, domain: 'notion.so' },
  { pattern: /\bopenai|\bchatgpt/i, domain: 'openai.com' },
  { pattern: /\bgithub/i, domain: 'github.com' },
  { pattern: /\bnetflix/i, domain: 'netflix.com' },
  { pattern: /\bspotify/i, domain: 'spotify.com' },
  { pattern: /\bhulu\b/i, domain: 'hulu.com' },
  { pattern: /\byoutube/i, domain: 'youtube.com' },
  { pattern: /\bapple\b|\bicloud/i, domain: 'apple.com' },
  { pattern: /\bavalon(\s*hayes|\s*bay)?/i, domain: 'avaloncommunities.com' },
  { pattern: /\bbilt\b/i, domain: 'biltrewards.com' },
  { pattern: /\bnike\b/i, domain: 'nike.com' },
  { pattern: /\blululemon/i, domain: 'lululemon.com' },
  { pattern: /\bpatagonia/i, domain: 'patagonia.com' },
  { pattern: /\buniglo|\buniqlo/i, domain: 'uniqlo.com' },
  { pattern: /\bcvs\b/i, domain: 'cvs.com' },
  { pattern: /\bwalgreens/i, domain: 'walgreens.com' },
  { pattern: /\bsquare\b|^sq\s*\*/i, domain: 'squareup.com' },
];

const NON_BRAND_KEYWORDS =
  /\b(direct\s*deposit|payroll|freelance|farmers\s*market|gear\s*sale|valet|cash\s*sale|consolidated\s*oct|restaurants\s*&\s*dining|shopping,\s*transit|internal\s*transfer)\b/i;

const MONOGRAM_TINTS = [
  'bg-slate-100 text-slate-700 border-slate-200/90 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  'bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70',
  'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
  'bg-amber-50 text-amber-800 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
  'bg-indigo-50 text-indigo-700 border-indigo-200/80 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/70',
  'bg-teal-50 text-teal-700 border-teal-200/80 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/70',
];

function computeMonogram(merchant: string): string {
  const cleaned = merchant
    .replace(/^(SQ|TST|APL|SP|PP)\s*\*\s*/i, '')
    .replace(/[^\p{L}\p{N}\s&]/gu, ' ')
    .trim();

  if (!cleaned) return 'TX';
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function inferMerchantDomain(merchant: string, rawDescription?: string): string | null {
  const combined = `${merchant} ${rawDescription || ''}`.trim();
  if (!combined) return null;

  // 1. Check explicit domain inside merchant or raw statement descriptor (e.g., COURSERA.ORG, SONIC.NET, UBER.COM)
  const explicitDomainMatch = combined.match(
    /\b([a-z0-9][a-z0-9-]{1,30}\.(?:com|org|net|io|co|ai|edu))\b/i
  );
  if (explicitDomainMatch) {
    const candidate = explicitDomainMatch[1].toLowerCase();
    // Ignore generic email hosts if a Gmail address is in raw text
    if (!['gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com'].includes(candidate)) {
      return candidate;
    }
  }

  // 2. Check curated brand patterns first (handles multi-brand bundles like "Netflix + Spotify" -> netflix.com, "SQ *..." -> squareup.com if unknown)
  // Note: Check specific merchants before generic SQ * fallback
  for (const entry of KNOWN_MERCHANT_DOMAINS) {
    if (entry.domain === 'squareup.com') continue;
    if (entry.pattern.test(combined)) {
      return entry.domain;
    }
  }

  // 3. Skip non-corporate / generic personal entries (payroll, farmers market, cash sale)
  if (NON_BRAND_KEYWORDS.test(combined)) {
    return null;
  }

  // If it's a Square terminal merchant we didn't match specifically, try inferring merchant slug first, or fall back cleanly
  const stripped = merchant
    .replace(/^(SQ|TST|APL|SP|PP)\s*\*\s*/i, '')
    .replace(/\(.*?\)/g, '')
    .split(/[—–·•*#/]/)[0]
    .replace(
      /\b(online|return|refund|trip|store|market|marketplace|inc|llc|corp|co|the|station|service|club|fitness|apartments|utility|autopay|monthly|annual|plan|subscription|bundle|all\s+apps|specialization)\b/gi,
      ' '
    )
    .replace(/[^a-z0-9\s]/gi, '')
    .trim();

  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const slug = tokens.slice(0, 2).join('').toLowerCase();
  if (slug.length < 3 || slug.length > 24) return null;

  return `${slug}.com`;
}

export function resolveMerchantBrand(
  merchant: string,
  options?: {
    rawDescription?: string;
    transactionType?: 'purchase' | 'refund' | 'income' | 'transfer';
    paymentMethod?: string;
  }
): ResolvedMerchantBrand {
  const monogram = computeMonogram(merchant);
  const tintClass = MONOGRAM_TINTS[hashString(merchant.toLowerCase()) % MONOGRAM_TINTS.length];

  const txType = options?.transactionType;
  const isCashOnly =
    options?.paymentMethod?.toLowerCase().includes('cash') &&
    NON_BRAND_KEYWORDS.test(merchant);

  const domain = inferMerchantDomain(merchant, options?.rawDescription);

  let fallbackKind: ResolvedMerchantBrand['fallbackKind'] = 'brand';
  if (txType === 'income') fallbackKind = 'income';
  else if (txType === 'transfer') fallbackKind = 'transfer';
  else if (isCashOnly) fallbackKind = 'cash';

  const logoEndpointUrl = domain
    ? `/api/merchant-logo?domain=${encodeURIComponent(domain)}&merchant=${encodeURIComponent(merchant)}`
    : null;

  return {
    domain,
    logoEndpointUrl,
    monogram,
    fallbackKind,
    tintClass,
  };
}
