# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

JobRadar-AI discovers tech job/internship postings, enriches them with AI-parsed job-description signals, filters them against a user's `config.json`, writes results to `data/`, and regenerates `README.md` as a job board. It's designed to run as a self-hosted GitHub Actions pipeline (see `installation.md` for the full operator-facing setup flow), but all pipelines are also runnable locally via the `jobctl` CLI.

## Commands

```bash
pnpm install                       # install deps
pnpm typecheck                     # tsc --noEmit
pnpm test                          # vitest run (all tests)
pnpm vitest run path/to/file.test.ts   # run a single test file
pnpm vitest run -t "test name"     # run tests matching a name
npx eslint .                       # lint (no dedicated npm script exists)

pnpm jobctl sync                   # community-source pipeline (see below)
pnpm jobctl scan                   # ATS discovery pipeline (see below)
pnpm jobctl setup check-config     # validate config.json + required env/secrets
pnpm jobctl setup get-config       # generate config.json from a GitHub issue body ($ISSUE_BODY)
pnpm jobctl notify latest          # email-notify for the most recent commit's new jobs
pnpm jobctl notify commit <sha>    # email-notify for jobs added in a specific commit
pnpm update-readme                 # regenerate README.md from data/opportunities.ndjson
pnpm preview-email                 # render a sample notification email locally
pnpm company                       # tsx scripts/company.ts
pnpm dedup                         # tsx scripts/dedup.ts
pnpm add-job                       # tsx scripts/link.ts
pnpm delete-url / pnpm clean-url   # tsx scripts/{delete-url,clean-url}.ts
```

`bin/jobradar.js` just re-exports `scripts/command/index.ts` (a Commander program); `jobctl` and `jobradar` are the same CLI.

## Architecture

### Two independent discovery pipelines feed one pool of `data/` files

- **Community sync** (`pnpm jobctl sync` → `scripts/command/sync/community.ts`): fetches curated GitHub README lists (see `SOURCES` in `src/constants/index.ts`) and parses them with `src/modules/github-parser` (markdown or HTML format per source) into `Job[]`.
- **ATS discovery** (`pnpm jobctl scan` → `scripts/command/sync/discover.ts`): crawls known ATS/company career sites via `src/modules/company-tacker` (fetches job listings, classifies each URL's ATS with `classifyATS()`, extracts company metadata) to produce `Job[]`, then runs an AI location classifier (`classifyLocations`) as a pre-filter.
- Both pipelines converge on `scripts/command/sync/shared/index.ts`'s `processJobs()`, which is the actual pipeline body:
  1. dedupe against already-seen URLs using `src/modules/job-dedup` (ATS-aware canonical keys — e.g. Workday/Greenhouse/Ashby job IDs — so the same posting reached via different query params/mirror URLs isn't reprocessed)
  2. fetch and AI-analyze each job description via `src/modules/jd-analyzer` (`getJD`) to extract structured `JD` (citizenship, sponsorship, qualifications, country, category, season)
  3. apply `isEligibleJD()` against `config.json`'s `target.filter`/`target.countries`/`target.intern`/`target["full-time"]`
  4. persist: `data/urls.json` (all seen URLs, for idempotency), `data/jobs.ndjson` (jobs that passed filtering — triggers `mail-notify.yml`), `data/opportunities.ndjson` (append-only feed the README is generated from), `data/company.json` (via `buildCompanyList`)
  5. runs under a soft deadline (`softDeadlineMs`, default 15 min) shorter than the GitHub Actions job timeout, so a run can stop starting new work gracefully instead of being hard-killed mid-write.

### ATS abstraction

`src/modules/company-tacker/ats/` and `src/modules/jd-analyzer/ats/` each implement one fetcher per ATS platform (Ashby, Greenhouse, Lever, Workday, iCIMS, Oracle Cloud, SmartRecruiters, Eightfold, Phenom, plus a generic `custom` fallback for direct-domain career pages). `classifyATS(url)` in `company-tacker/ats/index.ts` is the single source of truth for URL → ATS classification (by hostname suffix, then by tracking query params for ATS platforms that white-label their domain); `job-dedup` and `jd-analyzer` both call it before ATS-specific behavior branches. Adding support for a new ATS means adding a fetcher module plus a `classifyATS` branch — the two `ats/` directories are structurally parallel but serve different needs (company/listing extraction vs. single-JD-page extraction).

### AI provider abstraction

`src/utils/ai/index.ts` (`callAIModel`) dispatches to `src/utils/ai/provider/{google,anthropic,openai}.ts` based on `config.json`'s `ai.provider`. Setting `process.env.AI_MODE=DOWN` short-circuits AI calls entirely (returns `null` result, useful for testing pipelines without burning API credits). `src/modules/jd-analyzer/ai` and `src/modules/company-tacker/ai` are the two call sites (JD analysis and location classification respectively); their `spec.txt` files hold the prompt/schema documentation for what the AI is asked to return.

### Config

`config.json` (repo root, tracked in git — this is a self-hosted, single-user project, not a template with secrets in it) is validated by `src/validation/config.ts` (`ConfigSchema`, zod). `src/constants/index.ts` parses it once at import time into the `CONFIG` singleton — importing `@/constants` has this side effect, and `src/validation/config.ts` deliberately avoids importing from `@/constants` (only from `@/constants/country`) to avoid a circular dependency. Secrets (`SMTP_PASS`, `AI_API_KEY`) come from env vars, not `config.json`.

### Data files (`data/`, git-tracked)

- `urls.json` — every URL ever seen (idempotency ledger)
- `jobs.ndjson` — jobs that passed eligibility filtering (append-only; drives email notifications)
- `opportunities.ndjson` — append-only feed of all filtered jobs with `postedAt`; this is what `scripts/readme.ts` reads to regenerate the README job board (grouped by category, filtered again by `config.json` country/category targets — categories outside the configured targets still render, but collapsed into a `<details>` toggle)
- `company.json` — deduped company registry built from `urls.json` by `buildCompanyList`

### GitHub Actions wiring

Workflows in `.github/workflows/` are the production trigger points: `community-sync.yml`/`ats-discovery.yml` run the two pipelines on a cron and commit `data/` changes; `readme-update.yml` runs on push to `config.json`/`data/opportunities.ndjson`; `mail-notify.yml` and `setup-from-issue.yml`/`check-setup.yml` support the issue-driven setup flow described in `installation.md`. GitHub cron schedules are UTC.

## Conventions

- Path alias `@/*` → `src/*` (configured in both `tsconfig.json` and `vitest.config.mjs`); scripts under `scripts/` also use it.
- Imports use `eslint-plugin-simple-import-sort` with a specific group order (see `eslint.config.mjs`) — external packages, then `env`/`constants`, then internal `modules`/`utils`/etc. via the `@/` alias, then relative imports. Run the linter rather than hand-ordering imports.
- Type-only imports are enforced as separate `import type` statements (`@typescript-eslint/consistent-type-imports`).
- Tests are colocated as `*.test.ts` next to the code they cover and run under `vitest` with `environment: "node"`.
