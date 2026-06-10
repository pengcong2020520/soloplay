# AGENTS.md

## Project Overview

This is a Next.js 14 App Router project for an AI single-player murder mystery game. The product goal is to let one human player run a complete jubensha session with AI-controlled DM and NPC characters.

The app is local-first:

- It uses Prisma + SQLite by default (`prisma/dev.db`).
- It can run end-to-end without real LLM credentials by falling back to built-in scripts and mock agent responses.
- When credentials exist, LLM provider priority is Step (`STEP_API_KEY`) > Anthropic (`ANTHROPIC_API_KEY`) > mock.

Primary product docs are `README.md`, `PRD.md`, and `TECH_SPEC.md`. Prefer `README.md` as the current implementation reference when docs disagree.

## Document-First Development Rule

For every functional iteration or technical architecture change, follow this sequence before touching implementation code:

1. Read `PRD.md` and `TECH_SPEC.md`.
2. Update both documents once to align them with the current codebase and implementation reality.
3. Update both documents a second time with the new product requirements and technical architecture for the requested iteration.
4. Ask the user to review and confirm the updated PRD/spec.
5. Only after confirmation, implement code changes according to the confirmed documents and the existing code architecture.

Do not skip this process for UI, agent behavior, model-provider, data-model, or gameplay-flow changes. The user explicitly wants PRD/spec updates before development.

## Common Commands

- `npm run dev` - start Next.js locally, usually at `http://localhost:3000`.
- `npm run build` - production build.
- `npm run db:push` - sync Prisma schema to SQLite.
- `npm run db:generate` - regenerate Prisma client.
- `npm run db:seed` - seed local and built-in users/scripts.
- `npm run e2e` - Playwright smoke test. Requires the dev server to already be running.

`npm run lint` is configured as `next lint`, but confirm it works with the installed Next version before relying on it as the only verification step.

## Architecture Map

- `app/` contains pages and API route handlers.
- `app/game/[id]/GameClient.tsx` is the main gameplay UI.
- `app/replay/[id]/ReplayClient.tsx` is the reveal/replay UI.
- `app/setup/SetupWizard.tsx` handles guided script setup and generation.
- `lib/anthropic.ts` is the LLM abstraction for Step, Anthropic, and mock mode.
- `lib/agents/` contains DM, character, voting, summarization, consistency, generation, built-in script, and prompt logic.
- `lib/game/` contains phase configs, session loading, mechanics, voting, outcomes, feedback, and recommendations.
- `lib/auth/` contains local auth, signed cookie sessions, and current user helpers.
- `lib/db/prisma.ts` exports the shared Prisma client.
- `types/game.ts` contains shared domain types.
- `prisma/schema.prisma` is the source of truth for persisted data.

## Data And Domain Conventions

- SQLite stores enums as strings and arrays/objects as JSON strings. Central enum values live in `lib/constants.ts`; reuse them instead of introducing ad hoc literals.
- Keep ownership and visibility checks intact. Scripts and game sessions are user-scoped except built-in scripts owned by `builtin-library`.
- Guest play uses the `local-user` account. Do not break guest mode unless the task explicitly changes auth behavior.
- Agent information isolation matters: character agents should only receive the public script plus their own private script and appropriate recent/summarized context.
- Character turns are driven by a `directive` (see `lib/game/turn.ts`). Private chat passes a 1:1 directive so the agent answers the player directly; public free-discussion uses `runPublicGroupDiscussion` to make AI characters react to each other (auto-kicked on entering a 自由交流 phase, and on the `GROUP_DISCUSS` player command). When changing turn logic, keep history channel-labeled (public vs `[私聊·…]`) so agents don't conflate the two.
- Built-in scripts should stay playable without external services.

## LLM Notes

- `lib/anthropic.ts` exports stable `complete`, `streamComplete`, and `completeJson` style helpers used by higher-level agents.
- Step uses OpenAI-compatible chat completions and supports JSON mode via `response_format`.
- Anthropic mode uses prompt caching where applicable.
- Mock mode is a first-class path, not just a test stub. Preserve it during changes.
- Network/LLM failures should degrade gracefully in gameplay routes, especially SSE flows that may already have emitted partial content.

## Frontend Style

- UI is dark, compact, Tailwind-based, and shadcn-inspired. Reuse `components/ui/*` primitives and existing page patterns.
- Use `lucide-react` icons for buttons and navigational affordances when appropriate.
- Avoid large marketing-style landing sections for in-app work; the app should stay immediately usable.
- Keep text fitting responsive containers on both desktop and mobile.
- Respect existing Chinese product copy style unless the task asks for English.

## Testing Guidance

- For narrow logic changes, run `npm run build` or targeted TypeScript/build checks when feasible.
- For gameplay or route-flow changes, start the dev server and run `npm run e2e`.
- The E2E script assumes a running server at `BASE_URL` or `http://localhost:3000`.
- If real LLM keys are set, E2E can be slower; without keys it should exercise the mock path.

## Editing Guidance

- Keep changes scoped to the feature or bug being handled.
- Do not rewrite PRD/Tech Spec history just because implementation has moved; update `README.md` or this file only when it helps current development.
- Prefer structured parsing and Prisma APIs over string hacking for persisted data.
- Avoid destructive database or filesystem actions unless the user explicitly asks.
