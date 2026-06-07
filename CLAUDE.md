# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` contains detailed conventions (data/domain rules, LLM notes, frontend style, editing
guidance) and is the companion to this file — read it for anything not covered here. `README.md`
(Chinese) is the most current feature-level reference; prefer it over `PRD.md`/`TECH_SPEC.md` when
docs disagree.

## What this is

An AI single-player murder-mystery (剧本杀 / jubensha) game. One human plays a full session driven
by a DM Agent and per-character NPC Agents. Next.js 14 (App Router) + TypeScript + Prisma/SQLite.

**Local-first is a hard requirement, not a convenience.** The whole game runs end-to-end with no LLM
credentials: missing keys fall back to a built-in script (「雾港庄园谋杀案」) and mock agent
responses. Mock mode is a first-class code path — preserve it through any change. With credentials,
LLM backend priority is **Step (`STEP_API_KEY`) > Anthropic (`ANTHROPIC_API_KEY`) > mock**, selected
automatically with no code changes.

## Commands

```bash
npm install        # postinstall runs `prisma generate`
npm run db:push    # sync Prisma schema → prisma/dev.db (SQLite)
npm run db:seed    # seed local + builtin users/scripts (also lazily seeded at runtime)
npm run dev        # http://localhost:3000
npm run build      # production build
npm run db:studio  # inspect the SQLite DB

npm run e2e        # Playwright smoke test — REQUIRES dev server already running
HEADED=1 npm run e2e   # headed mode
```

`npm run lint` (`next lint`) exists but verify it works with the installed Next version before
relying on it as the sole check. There is no unit-test framework; `scripts/e2e-smoke.mjs` is the only
test and exercises the full flow (home → library → start → game → AI turn → advance phase → vote →
replay) against `BASE_URL` or `http://localhost:3000`. Without LLM keys it runs the fast mock path.

For narrow logic changes, `npm run build` (TypeScript check) is usually enough; for
gameplay/route-flow changes, run the dev server + `npm run e2e`.

## Architecture

Request flow: `app/api/**/route.ts` handlers → `lib/game/*` (game logic) + `lib/agents/*` (LLM
agents) → `lib/anthropic.ts` (provider abstraction) → `lib/db/prisma.ts` (shared Prisma client).

- **`lib/anthropic.ts`** — the single LLM seam. Exports `complete`, `streamComplete`, `completeJson`.
  Handles Step (OpenAI-compatible, JSON via `response_format`), Anthropic (with prompt caching), and
  mock. Has hardening for empty output, truncated JSON, streaming mid-failure, and retry/backoff
  (retry 429/5xx/timeout, give up on 4xx). All higher-level agents go through these helpers.
- **`lib/agents/`** — `dm-agent` (phase advancement, clue release, vote tally, ending decisions),
  `character-agent` (per-NPC roleplay), `vote-agent`, `char-to-char` (DM-mediated NPC↔NPC private
  talk), `script-generator`, `summarizer` (rolling context compression), `consistency-agent`
  (detects when an NPC's public speech contradicts its private script). Prompt templates live in
  `lib/agents/prompts/`; mock fallbacks in `lib/agents/mock-data.ts` and `builtin-scripts.ts`.
- **`lib/game/`** — `session.ts` (load session + owner check), `turn.ts`, `vote-engine.ts`,
  `outcome.ts`, `mechanics.ts` (special events), `feedback.ts`, `recommend.ts`. `phase-configs/`
  holds one phase state machine per script type (deduction / hardcore / emotional / comedy / horror /
  restoration) selected via `phase-configs/index.ts`. `turn.ts` drives character turns via a
  `directive`: private chat answers the player 1:1; `runPublicGroupDiscussion` makes AI characters
  talk to each other in the public channel (auto on entering a 自由交流 phase, or the `GROUP_DISCUSS`
  player command). History is channel-labeled (`[私聊·…]` vs public) so agents don't conflate them.
- **`lib/auth/`** — local email+password auth. `password.ts` (Node `crypto` scrypt, no extra deps),
  `session.ts` (HMAC-signed HttpOnly cookie carrying `tokenVersion`), `current-user.ts`. Logged-in
  users' scripts/sessions are account-scoped; cross-account access returns 403/404.
- **SSE streaming** — agent replies stream via "POST returns an SSE stream" (no separate subscribe
  endpoint, no Redis). Server side `lib/sse.ts`; client consumer `lib/client/sse-client.ts`. If an
  LLM call fails mid-stream, already-emitted content must not be lost and the SSE must not abort.

Key UI: `app/game/[id]/GameClient.tsx` (main gameplay), `app/replay/[id]/ReplayClient.tsx`
(reveal/replay), `app/setup/SetupWizard.tsx` (guided generation). Reuse `components/ui/*` primitives.

## Data & domain rules

- `prisma/schema.prisma` is the source of truth. SQLite stores **enums as strings and arrays/objects
  as JSON strings** — schema is written so it can switch to Postgres by changing the `provider`. All
  enum values live in **`lib/constants.ts`**; reuse them, never introduce ad-hoc string literals.
- **Ownership/visibility checks are load-bearing** — scripts and sessions are user-scoped, except
  built-in scripts owned by the `builtin-library` system account (`source=BUILTIN`, shared to all).
- **Guest play uses the `local-user` account** and must keep working without login. Don't break it
  unless the task explicitly changes auth.
- **Agent information isolation is a core invariant**: a character agent receives only the public
  script + its own private script + appropriate recent/summarized context — never other characters'
  private scripts.

## Three accounts that matter

`local-user` (guest), `builtin-library` (owns shared built-in scripts), and per-registered-user
accounts. Guest data can be claimed/migrated into a new account on registration
(`/api/auth/claim-guest`).
