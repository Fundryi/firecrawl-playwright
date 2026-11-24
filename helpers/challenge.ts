/**
 * Anti-bot interstitials that a real browser clears on its own after a few
 * seconds (Cloudflare "Just a moment...", DDoS-Guard and similar). While one
 * of these is showing, the page is not the content the caller asked for, and
 * its status (usually 403 or 503) is not the status of that content.
 */
const CHALLENGE_TITLES: RegExp[] = [
  /^just a moment/i, // Cloudflare managed / JS challenge
  /^attention required/i, // Cloudflare (older block or challenge page)
  /^checking your browser/i, // Cloudflare (older), reCAPTCHA interstitials
  /^one moment, please/i, // Cloudflare, some locales
  /^please wait/i, // generic "please wait while we verify" pages
  /^ddos-guard/i, // DDoS-Guard
  /^security check/i, // Sucuri and similar
];

export const isChallengeTitle = (title: string | null | undefined): boolean => {
  if (!title) return false;
  const t = title.trim();
  return CHALLENGE_TITLES.some((re) => re.test(t));
};

/** Error text Playwright raises when content() runs while the page navigates. */
export const isNavigatingError = (error: unknown): boolean =>
  error instanceof Error && /navigating|execution context was destroyed/i.test(error.message);

export interface ChallengeWaitDeps {
  /** Current main-frame title, or null while the page is between documents. */
  title: () => Promise<string | null>;
  /** Wait for the current document to finish loading (may throw on timeout). */
  waitForLoad: (timeoutMs: number) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/**
 * Waits while the page shows a challenge interstitial, up to maxWaitMs.
 * Returns whether a challenge was seen and whether it cleared in time.
 */
export const waitOutChallenge = async (
  deps: ChallengeWaitDeps,
  maxWaitMs: number,
  pollMs = 1000,
): Promise<{ seen: boolean; cleared: boolean }> => {
  const first = await deps.title();
  if (first !== null && !isChallengeTitle(first)) return { seen: false, cleared: true };
  const deadline = deps.now() + maxWaitMs;
  while (deps.now() < deadline) {
    await deps.waitForLoad(Math.max(1, deadline - deps.now())).catch(() => undefined);
    await deps.sleep(pollMs);
    const t = await deps.title();
    if (t !== null && !isChallengeTitle(t)) return { seen: true, cleared: true };
  }
  return { seen: true, cleared: false };
};
