import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostSkipped, looksBlocked, providersFromEnv, tryFallback } from './fallback';

const big = (s: string) => s + ' x'.repeat(30000);

test('blocked pages are recognised', () => {
  assert.equal(looksBlocked({ status: 403, content: '<html><title>g2.com</title><script src="https://geo.captcha-delivery.com/x.js"></script></html>' }), true);
  assert.equal(looksBlocked({ status: 200, content: '<html><head><title>Just a moment...</title></head></html>' }), true);
  assert.equal(looksBlocked({ status: 200, content: '<form action="/errors_page/validateCaptcha"><button>Continue shopping</button></form>' }), true);
  assert.equal(looksBlocked({ status: 429, content: '<p>slow down</p>' }), true);
  assert.equal(looksBlocked({ status: 403, content: '' }), true);
});

test('real pages are not treated as blocked', () => {
  assert.equal(looksBlocked({ status: 200, content: big('<title>Notion Reviews</title><p>review</p>') }), false);
  // a big real page that loads a captcha script somewhere is fine
  assert.equal(looksBlocked({ status: 200, content: big('<title>Shop</title><script src="https://geo.captcha-delivery.com/x.js"></script>') }), false);
  assert.equal(looksBlocked({ status: 404, content: '<title>Not found</title>' }), false);
  assert.equal(looksBlocked({ status: 200, content: '<title>Example Domain</title>' }), false);
});

test('providers come only from env, in order, and only when configured', () => {
  assert.deepEqual(providersFromEnv({}).map((p) => p.name), []);
  assert.deepEqual(providersFromEnv({ SCRAPEDO_TOKEN: 't' }).map((p) => p.name), ['scrapedo']);
  // Bright Data needs both key and zone
  assert.deepEqual(providersFromEnv({ BRIGHTDATA_API_KEY: 'k' }).map((p) => p.name), []);
  assert.deepEqual(providersFromEnv({ SCRAPEDO_TOKEN: 't', BRIGHTDATA_API_KEY: 'k', BRIGHTDATA_ZONE: 'z' }).map((p) => p.name), ['scrapedo', 'brightdata']);
  assert.deepEqual(providersFromEnv({ SCRAPEDO_TOKEN: 't', BRIGHTDATA_API_KEY: 'k', BRIGHTDATA_ZONE: 'z', FALLBACK_PROVIDERS: 'brightdata, scrapedo' }).map((p) => p.name), ['brightdata', 'scrapedo']);
});

test('skip list matches host and subdomains', () => {
  const env = { FALLBACK_SKIP_HOSTS: 'example.com, internal.test' };
  assert.equal(hostSkipped('https://example.com/a', env), true);
  assert.equal(hostSkipped('https://www.example.com/a', env), true);
  assert.equal(hostSkipped('https://notexample.com/a', env), false);
  assert.equal(hostSkipped('https://g2.com/a', {}), false);
});

const fakeResponse = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

test('fallback returns the first unblocked provider result', async () => {
  const env = { SCRAPEDO_TOKEN: 't', BRIGHTDATA_API_KEY: 'k', BRIGHTDATA_ZONE: 'z' };
  const calls: string[] = [];
  const doFetch = (async (input: string | URL | Request) => {
    const u = String(input);
    calls.push(u.includes('scrape.do') ? 'scrapedo' : 'brightdata');
    if (u.includes('scrape.do')) return fakeResponse(big('<title>Real page</title>'), 200, { 'scrape.do-initial-status-code': '200' });
    return fakeResponse('', 200);
  }) as typeof fetch;
  const r = await tryFallback('https://www.g2.com/x', providersFromEnv(env), 1000, doFetch, () => {});
  assert.equal(r?.provider, 'scrapedo');
  assert.deepEqual(calls, ['scrapedo']); // second provider not called
});

test('fallback moves on when a provider is blocked, errors, or gives up', async () => {
  const env = { SCRAPEDO_TOKEN: 't', BRIGHTDATA_API_KEY: 'k', BRIGHTDATA_ZONE: 'z' };
  let n = 0;
  const doFetch = (async (input: string | URL | Request) => {
    n++;
    if (String(input).includes('scrape.do')) throw new Error('network down');
    return fakeResponse('', 200, { 'x-brd-error-code': 'dd_hardblock' });
  }) as typeof fetch;
  const r = await tryFallback('https://www.g2.com/x', providersFromEnv(env), 1000, doFetch, () => {});
  assert.equal(r, null);
  assert.equal(n, 2);
});

test('blocked provider content is not accepted', async () => {
  const doFetch = (async () => fakeResponse('<title>Just a moment...</title>', 200, { 'scrape.do-initial-status-code': '200' })) as typeof fetch;
  const r = await tryFallback('https://x.test/', providersFromEnv({ SCRAPEDO_TOKEN: 't' }), 1000, doFetch, () => {});
  assert.equal(r, null);
});
