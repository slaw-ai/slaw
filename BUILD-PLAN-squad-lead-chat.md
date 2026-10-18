# BUILD PLAN — Squad Lead Chat

_Companion to `DESIGN-squad-lead-chat.md` (design locked 2026-06-21). This is the phased,
git-disciplined execution plan. Read the design first; this plan assumes its decisions._

---

## Codebase targeting (verified this session — do NOT assume)

Before any edit, confirm the mount path. Verified 2026-06-21:

| Repo | Mounted? | Branch | Role | This feature touches it? |
|------|----------|--------|------|--------------------------|
| `slaw` | ✅ yes | `master` (clean @ `b8b5ef3`) | **Runtime** monorepo (server/UI/CLI/packages). Has `packages/db/src/schema/issues.ts`. | **YES — all code.** |
| `slaw.com` | ✅ yes | `main` (⚠️ 1 commit ahead of origin, unpushed) | **LIVE marketing** site (slaw.run), static SPA, Firebase. | YES — marketing copy (Phase 7). |
| `slaw-documentation` | ✅ yes | not a live site | **Spec/IA folder only.** Editing it does NOT change docs.slaw.run. | Optional spec notes only. |
| `slaw-documentation-portal` | ❌ **NOT mounted** | — | **LIVE docs** (docs.slaw.run), Docusaurus, content under `site/docs-slaw/*.mdx`. | YES — but **cannot commit here this session.** Draft + stage; commit in a session where it's mounted. |
| `slaw-botfather` | ✅ yes | `master` | Control tower. | Only the tower reporter exclusion (Phase 1) — see note. |

**Rules baked in:**
- Every phase states **which repo(s)** it touches. Never edit `slaw/docs/` (legacy Mintlify) or
  `slaw-documentation/` expecting the live docs to change — they won't.
- Docs-portal updates are **drafted into `slaw/DOCS-STAGING/`** when the portal isn't mounted, with
  a checklist item to port them when it is. Never silently skip them.
- The `slaw.com` repo is already 1 commit ahead of origin — **flag to user to push that first** so
  our marketing commit lands on a clean, pushed base.

---

## Git principles (strict — applied to every phase)

1. **One phase = one logical, self-contained, green commit.** No "WIP" commits on `master`/`main`.
   A phase only commits when: server `tsc` clean, new + existing tests green, tree otherwise clean.
2. **Conventional Commits.** `feat(lead-chat): …`, `feat(db): …`, `test(lead-chat): …`,
   `docs(lead-chat): …`, `chore(lead-chat): …`. Scope is `lead-chat` for runtime feature work.
3. **Build in a work copy, never against the mounted `node_modules`** (it's mac-native). Use
   `/sessions/<session>/slaw-work` with `pnpm 9.15.4`, rsync changes back to the mount. (See
   `slaw-git-workflow` memory.)
4. **Commit + push happen on the Mac, by the user**, not from the sandbox (sandbox has no GitHub
   creds and leaves stale `.git/*.lock`). Each phase ends by producing a ready-to-run commit script
   `scripts/commit-phaseN-lead-chat.sh` (staged file list + exact commit message) for the user.
5. **Clean tree between phases.** No orphaned snapshot/meta files left behind (the drizzle
   `0099_snapshot.json` orphan trap — don't generate it; hand-author migration only).
6. **Nothing merges to a feature surface without its docs + marketing obligation resolved** (or
   explicitly deferred with a tracked TODO). See the per-phase "Docs/Marketing" line.
7. **Rollback safety:** because each phase is independently green and committed, any phase boundary
   is a safe revert point. The migration (Phase 1) is additive (new column with default) — safely
   reversible.
8. **PROJECT.md + ROADMAP.md + CHANGELOG.md updated in the SAME phase commit that ships the
   user-visible change** (Keep a Changelog format), per the standing publish checklist.

**Per-phase definition of done (DoD):** code green → tests green → tree clean → docs/marketing
obligation done-or-deferred → tracker files updated → commit script written → learnings noted.

---

## Phasing overview

| Phase | Title | Repo(s) | Ships |
|-------|-------|---------|-------|
| 0 | Branch + work-copy setup | slaw | A working branch + verified build baseline |
| 1 | DB: `thread_type` column + migration 0099 | slaw (+ botfather reporter note) | Schema, exclusions |
| 2 | Lead-thread service (get-or-create) | slaw | `getOrCreateLeadThread()` |
| 3 | Wake routing (`lead_chat` source) | slaw | Human message wakes the Lead, F3-safe |
| 4 | Squad Lead "Chat mode" instructions | slaw | Onboarding asset update |
| 5 | `lead_decision` interaction + acknowledge | slaw | Decision outcome end-to-end |
| 6 | Outcome creation helpers (Issue/Plan/Approval/Decision) | slaw | All four outcomes server-side |
| 7 | API: `GET /squads/:id/lead-thread` | slaw | Thin contract endpoint |
| 8 | UI: chat surface | slaw | Lead chat panel/route |
| 9 | UI: outcome cards | slaw | Issue/Plan/Approval/Decision cards |
| 10 | Reliability verification (F1/F3/F5) | slaw | Confirmed guardrails |
| 11 | Docs portal + marketing + final tracker | docs-portal (staged), slaw.com, slaw | Public-facing |

Phases 1–7 are backend and can land before any UI. Phases 8–9 are UI. Phase 10 is verification.
Phase 11 is the public-facing rollup. **Docs/marketing are touched incrementally per phase (draft)
and finalized/published in Phase 11.**

---

## Phase 0 — Branch & work-copy setup
**Repo:** `slaw`.
- Create feature branch `feat/squad-lead-chat` off `master` (`b8b5ef3`). All phase commits land on
  this branch; merge to `master` only after Phase 10 passes (or merge per-phase if user prefers a
  fast-forward trunk flow — confirm with user).
- Stand up the work copy: rsync `slaw` → `/sessions/<session>/slaw-work`, `pnpm install` with
  `pnpm 9.15.4`, run `pnpm --filter server typecheck` + the heartbeat/issues test subset to capture
  a **green baseline** before changing anything.
- **DoD:** branch exists; baseline build + tests green and recorded. No code change yet.
- **Docs/Marketing:** none.
- **Commit:** none (setup only) — or an empty-tree branch marker if user wants the branch pushed.
- **Learnings:** record baseline test counts so regressions are obvious later.

## Phase 1 — DB: `thread_type` column + migration `0099`
**Repo:** `slaw` (schema + migration). **Cross-repo note:** `slaw-botfather` reporter exclusion is
read-only awareness here; the actual exclusion in SLAW's own `reconcileEntities()` is in `slaw`.
- Add `thread_type text NOT NULL DEFAULT 'issue'` to `packages/db/src/schema/issues.ts`.
- Hand-author `packages/db/src/migrations/0099_lead_chat.sql`:
  `ALTER TABLE issues ADD COLUMN thread_type text NOT NULL DEFAULT 'issue';` +
  `CREATE INDEX issues_lead_thread_idx ON issues (squad_id) WHERE thread_type = 'lead';`
  (statement-breakpoints between).
- Append `_journal.json` entry `{ idx: 99, version: "7", when: <ts>, tag: "0099_lead_chat",
  breakpoints: true }`. **Do NOT run drizzle-kit generate** (leaves a bogus 200-line migration +
  orphan snapshot — known gotcha).
- Audit & exclude `thread_type='lead'` from: issue list queries, kanban board grouping, and the
  tower reporter `reconcileEntities()` issue re-emit (all in `slaw`).
- Verify the custom journal-driven applier picks up 0099 against a fresh embedded DB.
- **DoD:** migration applies clean; schema typechecks; exclusion queries covered by a test.
- **Docs/Marketing:** none yet (internal).
- **Tracker:** none yet (no user-visible behavior).
- **Commit:** `feat(db): add issues.thread_type for Lead threads (migration 0099)` →
  `scripts/commit-phase1-lead-chat.sh`.
- **Learnings:** confirm applier behavior + that no orphan `meta/0099_snapshot.json` was created;
  if the sandbox left one, flag for `rm` on Mac.

## Phase 2 — Lead-thread service
**Repo:** `slaw` (server).
- `getOrCreateLeadThread(squadId)` in a service module: finds the squad's `thread_type='lead'`
  issue or creates one (assigned to the `squad_lead` agent, `status` per design, `thread_type='lead'`).
  Idempotent (unique-by-squad enforced via lookup + the partial index).
- **DoD:** unit test: first call creates, second returns same id; no duplicate under concurrency.
- **Docs/Marketing:** none.
- **Commit:** `feat(lead-chat): get-or-create per-squad Lead thread` → phase2 script.
- **Learnings:** note the squad_lead lookup query used (reuse the verified `role='squad_lead'`).

## Phase 3 — Wake routing (`lead_chat` source, F3-safe)
**Repo:** `slaw` (server).
- In the `POST /issues/:id/comments` handler: when the issue is `thread_type='lead'` and the
  author is a user, fire `queueIssueAssignmentWakeup({ source: 'lead_chat', triggerDetail: <commentId>, … })`
  AND call the wake-cycle guard's `noteStateChange()` on the thread so a genuine human reply always
  resets F3 loop suppression and re-wakes the Lead.
- **DoD:** tests — (a) user message on a Lead thread wakes the squad_lead agent; (b) `noteStateChange`
  is invoked so a reply after a prior suppression still wakes; (c) no new agent-to-agent edge created.
- **Docs/Marketing:** none.
- **Commit:** `feat(lead-chat): wake Squad Lead on chat messages (F3-safe)` → phase3 script.
- **Learnings:** confirm the exact `source`/`triggerDetail` contract the heartbeat reads.

## Phase 4 — Squad Lead "Chat mode" instructions
**Repo:** `slaw` (`server/src/onboarding-assets/squad_lead/`).
- Add a concise "Chat mode" section to `HEARTBEAT.md` (and a pointer in `AGENTS.md`): when woken
  with `source=lead_chat`, reply conversationally in ONE comment; commit to real work objects
  (issue/plan/approval/decision) only when the conversation calls for it; keep replies short; don't
  re-plan the whole squad each message; respect prompt budget.
- **DoD:** asset files updated; any onboarding-bundle test still green.
- **Docs/Marketing:** none (internal agent instructions).
- **Commit:** `feat(lead-chat): Squad Lead chat-mode operating instructions` → phase4 script.
- **Learnings:** note how onboarding assets are loaded so we know the change takes effect on
  (re)bootstrap vs. live agents.

## Phase 5 — `lead_decision` interaction + acknowledge endpoint
**Repo:** `slaw` (server).
- Register `kind='lead_decision'` in `issue_thread_interactions` handling with
  `payload={title, rationale, impactArea?, options?, chosen?}` and
  `result={acknowledgedByUserId, acknowledgedAt, note?}`.
- Add `POST /issues/:id/interactions/:interactionId/acknowledge`.
- **DoD:** tests — create→acknowledge lifecycle, idempotency key respected, status transitions
  (pending→acknowledged).
- **Docs/Marketing:** none yet.
- **Commit:** `feat(lead-chat): lead_decision interaction + acknowledge` → phase5 script.

## Phase 6 — Outcome creation helpers (all four)
**Repo:** `slaw` (server).
- Helpers the Lead uses during its run to emit outcomes, each wired to EXISTING services and tagged
  with `originLeadThreadId`:
  - **Issue** → existing create-issue path, linked to the Lead thread.
  - **Plan** → parent issue + `createChild()` children.
  - **Approval** → `approvals` + `issueApprovals`, resolved via existing `resolveApproval()`.
  - **Decision** → the `lead_decision` interaction from Phase 5.
- **DoD:** tests for each — object created, linked back to Lead thread, appears correctly, excluded
  from task board where appropriate.
- **Docs/Marketing:** none yet.
- **Commit:** `feat(lead-chat): outcome helpers — issue, plan, approval, decision` → phase6 script.

## Phase 7 — API: `GET /squads/:id/lead-thread`
**Repo:** `slaw` (server).
- Thin endpoint returning the Lead thread id (lazy get-or-create via Phase 2) + the squad_lead agent
  summary. CLI-friendly shape.
- **DoD:** contract test; authz consistent with other squad-scoped routes.
- **Docs/Marketing:** none yet.
- **Commit:** `feat(lead-chat): GET squad lead-thread endpoint` → phase7 script.

## Phase 8 — UI: chat surface
**Repo:** `slaw` (`ui/src`).
- Sidebar entry "Talk to your Squad Lead" + a focused chat route/panel reusing `<IssueChatThread>`
  (markdown, mentions, optimistic send, live updates) in a chat layout (not full IssueDetail chrome).
  Open question 5 (sidebar vs dashboard vs both) — default: sidebar + small dashboard launcher.
- **DoD:** UI typechecks; component tests for the chat panel render + send; live updates confirmed.
- **Docs/Marketing:** **draft** a docs-portal "Squad Lead Chat" page into `slaw/DOCS-STAGING/`
  (portal not mounted) + draft a marketing one-liner for `slaw.com` (apply in Phase 11).
- **Commit:** `feat(lead-chat): Squad Lead chat UI` → phase8 script.

## Phase 9 — UI: outcome cards
**Repo:** `slaw` (`ui/src`).
- Inline IssueCreated / Plan / Approval / Decision cards rendering from the comment
  `presentation`/`metadata` or linked interaction/approval, each with its operator action (open,
  accept plan, approve/request-changes/reject, acknowledge).
- **DoD:** component tests per card incl. the resolve action calling the right endpoint.
- **Docs/Marketing:** extend the staged docs page with the outcome-card screenshots/flow.
- **Commit:** `feat(lead-chat): chat outcome cards (issue/plan/approval/decision)` → phase9 script.

## Phase 10 — Reliability verification
**Repo:** `slaw` (tests only).
- Confirm: F1 circuit-breaker pause renders as a "paused until usage resets" state in chat; F3 does
  NOT suppress a genuine human reply; F5 prompt budget bounds long Lead threads.
- **DoD:** explicit tests/asserts for each; manual end-to-end (open chat → message → Lead replies →
  produce a plan + a decision → acknowledge) documented in the handover.
- **Docs/Marketing:** none (verification).
- **Commit:** `test(lead-chat): reliability guardrail coverage (F1/F3/F5)` → phase10 script.

## Phase 11 — Docs portal + marketing + final tracker (public-facing rollup)
**Repos:** `slaw-documentation-portal` (**not mounted — stage + flag**), `slaw.com` (marketing),
`slaw` (trackers).
- **Docs portal (LIVE docs.slaw.run):** port the staged page from `slaw/DOCS-STAGING/` into
  `slaw-documentation-portal/site/docs-slaw/*.mdx` **in a session where the portal is mounted**
  (run git from `site/`). Until then, the page is staged and this item stays open with a clear TODO.
  Mind the portal gotchas (`:::note[Title]` syntax, relative font urls, pnpm 11, CI auto-deploys
  from the private repo).
- **Marketing (LIVE slaw.run):** add a Squad Lead Chat line/tile to `slaw.com`. **First confirm the
  user pushes the existing 1-commit-ahead state** so our change lands clean. Don't re-run
  `firebase init hosting:github` (it regenerates the npm-build workflow that breaks the static site).
- **Trackers (`slaw`):** flip ROADMAP.md `⚪ Squad Lead Chat → ✅`; update PROJECT.md status snapshot;
  add a CHANGELOG.md entry (Keep a Changelog). README "works-with"/feature row if warranted.
- **DoD:** trackers updated in `slaw`; marketing change committed in `slaw.com`; docs-portal change
  either committed (if mounted) or staged-with-TODO (if not).
- **Commits:**
  - `slaw`: `docs(lead-chat): roadmap/changelog/project tracker for Squad Lead Chat`
  - `slaw.com`: `feat: add Squad Lead Chat to marketing site`
  - `slaw-documentation-portal` (when mounted): `docs: add Squad Lead Chat page`
  - One commit script per repo (separate — never cross-repo commits).
- **Learnings:** update the `slaw-squad-lead-chat` memory to "BUILT", record final HEAD per repo and
  any deferred docs-portal TODO.

---

## Standing obligations checklist (every phase)
- [ ] Confirmed correct repo + mount path before editing.
- [ ] Built in work copy, not against mount `node_modules`.
- [ ] `tsc` clean + relevant tests green.
- [ ] Tree clean; no orphan migration/meta files.
- [ ] Docs/marketing obligation done OR explicitly staged with a tracked TODO.
- [ ] Tracker files updated if user-visible.
- [ ] Conventional-commit message + commit script written for the user to run on the Mac.
- [ ] Learnings captured (memory + this plan's notes).

## Pre-flight items to resolve with the user before Phase 0
1. **Branch strategy:** one `feat/squad-lead-chat` branch merged after Phase 10, vs. per-phase
   commits straight to `master`. (Plan assumes a feature branch.)
2. **`slaw.com` is 1 commit ahead of origin** — push that before Phase 11 marketing commit.
3. **Docs portal not mounted** — accept staged-docs-now / publish-later, or mount it this session.
