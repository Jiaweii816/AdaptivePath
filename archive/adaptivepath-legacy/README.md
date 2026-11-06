# AdaptivePath legacy Biology assets

Archived from commit `07f7808` on `feature/biology-workbench-integration` when the
Biology practice flow moved to the 10-concept / 320-question bank and the
L1/L2/L3 learner memory (see `docs/superpowers/specs/2026-10-31-biology-l1-l2-l3-memory-design.md`,
local only).

Files keep their original repository-relative paths. This directory is **not**
part of the build: it is excluded in `tsconfig.json` and `eslint.config.mjs`,
vitest only scans `tests/unit/`, and Playwright only scans `tests/e2e/`. Main
code must not import anything from here.

| File | What it was |
| --- | --- |
| `src/features/adaptivepath/content.ts` | The original 9 pitch questions (D1–D4, G1–G2, T1–T3) and the combined 33-question bank |
| `src/features/adaptivepath/expanded-questions.ts` | 24 expanded CER activities over the 7 legacy topics |
| `src/features/adaptivepath/profile.ts` | `deriveProfile` / `nextQuestionId`: per-request mastery (unknown/emerging/stable) and misconception tags |
| `src/features/adaptivepath/coach-policy.ts` | Old tutor tool policy (diagnostic_probe, prerequisite_review, …) |
| `src/features/adaptivepath/textbook-chunks.ts` | Old 7-topic paragraph chunker over the transcribed text |
| `src/features/adaptivepath/data/biology-12-2-extracted.ts` | User-supplied transcription of §12.2 used by the old chunker |
| `src/features/adaptivepath/legacy-reference-ids.json` | Old chunk id → new PDF chunk id mapping, removed from `textbook-locations.json` |
| `src/server/adaptivepath/evaluate.ts` | Answer keys and regex CER grader for the 33 old questions |
| `src/server/adaptivepath/ledger-store.ts` | Old per-session ChatSession / L1 event adapter (one demo user per session) |
| `tests/unit/adaptivepath-profile.test.ts` | Tests for the old profile rules and question bank |
| `scripts/adaptivepath-http-smoke.ts` | HTTP smoke test of the old D1-branching API |
| `scripts/build-biology-textbook-locations.ts` | Old locations builder that also generated the legacy mapping |
