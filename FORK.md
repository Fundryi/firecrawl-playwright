# About this fork

Fork of [carneirofc/firecrawl-playwright](https://github.com/carneirofc/firecrawl-playwright),
a stealth drop-in for Firecrawl's `playwright-service` (headed Google Chrome via Patchright
under Xvfb). Everything in the upstream README still applies. Image:
`ghcr.io/fundryi/firecrawl-playwright:latest` (`linux/amd64`).

## What this fork adds

All changes are in `api.ts` (`scrapePage`) and `helpers/challenge.ts`; tests in
`helpers/challenge.spec.ts`.

| Change | Why |
|---|---|
| Waits while an anti-bot interstitial is showing ("Just a moment...", "Checking your browser", DDoS-Guard and similar), up to `CHALLENGE_MAX_WAIT_MS` (default 20000) | Firecrawl's default wait is 0, so a Cloudflare page was returned while the challenge was still running |
| Reports the status of the document it returns (the last main-frame response), not the first response | After a cleared challenge the first response is 403 and the real page is 200; callers threw away good pages |
| Retries `page.content()` while the page is navigating | Grabbing content during the challenge redirect failed with "page is navigating" |
| Clicks Amazon's "Continue shopping" checkpoint, then opens the requested URL again | The checkpoint sometimes replaces the product page; the click itself lands on the home page |
| Waits up to `SETTLE_MS` (default 1500) for a follow-up navigation when the page is not a plain 200 or is smaller than `SETTLE_SMALL_PAGE_BYTES` (default 10000) | Cookie stubs that reload themselves (for example PMC's 203 "Cookies must be enabled") |
| Logs every main-frame document response (`↪ status method url`) | Makes challenge and redirect chains visible in the container log |

## Upkeep

- `sync-upstream` (daily) merges upstream `main` and starts the image build when it changed. A conflict fails the job and is merged by hand.
- `image` builds on every push to `main`, on demand, and weekly (fresh Chrome stable).
- No credentials, hostnames or settings of any deployment belong in this repo; configuration is environment variables only.
