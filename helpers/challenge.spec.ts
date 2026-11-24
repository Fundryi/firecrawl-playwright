import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChallengeTitle, isNavigatingError, waitOutChallenge } from './challenge';

test('challenge titles are recognised, normal titles are not', () => {
  for (const t of ['Just a moment...', '  just a moment', 'Attention Required! | Cloudflare', 'Checking your browser - reCAPTCHA', 'DDoS-Guard']) {
    assert.equal(isChallengeTitle(t), true, t);
  }
  for (const t of ['Example Domain', 'Amazon.com: Echo Dot', 'java - Why is processing a sorted array faster', '', null, undefined]) {
    assert.equal(isChallengeTitle(t), false, String(t));
  }
});

test('navigating errors are recognised', () => {
  assert.equal(isNavigatingError(new Error('page.content: Unable to retrieve content because the page is navigating and changing the content.')), true);
  assert.equal(isNavigatingError(new Error('Execution context was destroyed, most likely because of a navigation')), true);
  assert.equal(isNavigatingError(new Error('net::ERR_NAME_NOT_RESOLVED')), false);
  assert.equal(isNavigatingError('navigating'), false);
});

const fakePage = (titles: (string | null)[]) => {
  let t = 0;
  let i = 0;
  return {
    title: async () => titles[Math.min(i++, titles.length - 1)],
    waitForLoad: async () => undefined,
    sleep: async (ms: number) => {
      t += ms;
    },
    now: () => t,
  };
};

test('no challenge: returns at once without waiting', async () => {
  const p = fakePage(['Example Domain']);
  assert.deepEqual(await waitOutChallenge(p, 20_000), { seen: false, cleared: true });
  assert.equal(p.now(), 0);
});

test('challenge that clears after a navigation', async () => {
  const p = fakePage(['Just a moment...', null, 'Just a moment...', 'Real page']);
  assert.deepEqual(await waitOutChallenge(p, 20_000), { seen: true, cleared: true });
  assert.equal(p.now(), 3000);
});

test('challenge that never clears stops at the limit', async () => {
  const p = fakePage(['Just a moment...']);
  assert.deepEqual(await waitOutChallenge(p, 5000), { seen: true, cleared: false });
  assert.equal(p.now(), 5000);
});

test('page between documents at the start counts as unknown, then clears', async () => {
  const p = fakePage([null, 'Real page']);
  assert.deepEqual(await waitOutChallenge(p, 20_000), { seen: true, cleared: true });
});
