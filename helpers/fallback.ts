/**
 * Last-resort fallback for pages the browser could not get past (bot walls such as
 * DataDome). Only used when our own headed browser came back blocked, and only through
 * providers whose credentials are set, in the order given. Every provider is an optional
 * paid unblocker API; with no credentials configured this module does nothing.
 *
 *   FALLBACK_PROVIDERS        comma list, default "scrapedo,brightdata"
 *   SCRAPEDO_TOKEN            enables Scrape.do   (GET api.scrape.do)
 *   BRIGHTDATA_API_KEY        enables Bright Data (POST api.brightdata.com/request)
 *   BRIGHTDATA_ZONE           Web Unlocker zone name (required with the key)
 *   FALLBACK_TIMEOUT_MS       per provider, default 90000
 *   FALLBACK_SKIP_HOSTS       comma list of hosts never sent to a paid provider
 */
import { isChallengeTitle } from './challenge';

export interface PageResult {
  content: string;
  status: number | null;
}

export interface FallbackResult {
  content: string;
  status: number;
  provider: string;
}

/** Strong markers of a bot wall in the returned HTML. */
const BLOCK_MARKERS: RegExp[] = [
  /captcha-delivery\.com/i, // DataDome
  /geo\.captcha-delivery/i,
  /<title>\s*just a moment/i, // Cloudflare
  /cf-challenge|challenge-platform/i,
  /px-captcha|_pxCaptcha/i, // PerimeterX / HUMAN
  /validateCaptcha/i, // Amazon
  /<title>\s*(access denied|attention required)/i,
];

const titleOf = (html: string): string | null => {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].trim() : null;
};

/**
 * Was the browser result blocked by a bot wall? 401/403/429/503 with little content,
 * a challenge title, or a bot-wall marker in a small page. A big real page that merely
 * mentions a captcha script is not treated as blocked.
 */
export const looksBlocked = (r: PageResult): boolean => {
  const html = r.content || '';
  if (isChallengeTitle(titleOf(html))) return true;
  const small = html.length < 20000;
  if (small && BLOCK_MARKERS.some((re) => re.test(html))) return true;
  if (r.status !== null && [401, 403, 429, 503].includes(r.status) && html.length < 50000) return true;
  return false;
};

type Fetcher = typeof fetch;

export interface ProviderConfig {
  name: string;
  enabled: boolean;
  fetchPage: (url: string, timeoutMs: number, doFetch: Fetcher) => Promise<FallbackResult | null>;
}

const withTimeout = (ms: number) => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, done: () => clearTimeout(t) };
};

export const providersFromEnv = (env: NodeJS.ProcessEnv): ProviderConfig[] => {
  const scrapedo: ProviderConfig = {
    name: 'scrapedo',
    enabled: !!env.SCRAPEDO_TOKEN,
    fetchPage: async (url, timeoutMs, doFetch) => {
      const q = new URLSearchParams({ token: env.SCRAPEDO_TOKEN || '', url });
      const { signal, done } = withTimeout(timeoutMs);
      try {
        const res = await doFetch(`https://api.scrape.do/?${q}`, { signal });
        const status = Number(res.headers.get('scrape.do-initial-status-code')) || res.status;
        return { content: await res.text(), status, provider: 'scrapedo' };
      } finally {
        done();
      }
    },
  };
  const brightdata: ProviderConfig = {
    name: 'brightdata',
    enabled: !!env.BRIGHTDATA_API_KEY && !!env.BRIGHTDATA_ZONE,
    fetchPage: async (url, timeoutMs, doFetch) => {
      const { signal, done } = withTimeout(timeoutMs);
      try {
        const res = await doFetch('https://api.brightdata.com/request', {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${env.BRIGHTDATA_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ zone: env.BRIGHTDATA_ZONE, url, format: 'raw' }),
        });
        if (res.headers.get('x-brd-error-code')) return null; // Bright Data gave up (e.g. dd_hardblock)
        const status = Number(res.headers.get('x-brd-status-code')) || res.status;
        return { content: await res.text(), status, provider: 'brightdata' };
      } finally {
        done();
      }
    },
  };
  const all: Record<string, ProviderConfig> = { scrapedo, brightdata };
  const order = (env.FALLBACK_PROVIDERS || 'scrapedo,brightdata')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s in all);
  return order.map((n) => all[n]).filter((p) => p.enabled);
};

export const hostSkipped = (url: string, env: NodeJS.ProcessEnv): boolean => {
  const skip = (env.FALLBACK_SKIP_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (skip.length === 0) return false;
  const host = new URL(url).hostname.toLowerCase();
  return skip.some((s) => host === s || host.endsWith(`.${s}`));
};

/**
 * Try the providers in order; return the first result that is not blocked, or null.
 * Never throws: a provider error just moves on to the next one.
 */
export const tryFallback = async (
  url: string,
  providers: ProviderConfig[],
  timeoutMs: number,
  doFetch: Fetcher = fetch,
  log: (msg: string) => void = console.log,
): Promise<FallbackResult | null> => {
  for (const p of providers) {
    try {
      const r = await p.fetchPage(url, timeoutMs, doFetch);
      if (r && r.status >= 200 && r.status < 300 && !looksBlocked(r)) {
        log(`🛟 Fallback ${p.name}: got the page (status ${r.status}, ${r.content.length} bytes)`);
        return r;
      }
      log(`🛟 Fallback ${p.name}: still blocked${r ? ` (status ${r.status})` : ''}`);
    } catch (error) {
      log(`🛟 Fallback ${p.name}: error ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return null;
};
