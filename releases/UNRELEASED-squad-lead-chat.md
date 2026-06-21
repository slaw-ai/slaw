# Slaw — Unreleased: Squad Lead Chat

_Running release note, appended per build phase on `feat/squad-lead-chat`. This becomes the
real `releases/vYYYY.MDD.P.md` at Phase 11 (rollup). Roadmap milestone: "Squad Lead Chat"._

Squad Lead Chat is a lightweight, conversational way to talk to the Squad Lead that resolves to
real work objects — issues, plans, approvals, and decisions — without leaving the task model. A
chat message is an issue comment, a reply is an issue comment, and concrete outcomes become the
same first-class, governed objects used everywhere else in Slaw.

## Highlights (so far)

- **A per-squad Lead thread.** Each squad gets one durable conversation with its Squad Lead,
  backed by a normal issue row marked `thread_type = 'lead'`. It is excluded from the kanban
  board, issue lists, and the fleet/tower issue counts, so chatting never clutters your task
  board. (Phase 1–2)
- **Talk to your Squad Lead and it answers.** A chat message wakes the Squad Lead through the
  existing comment→wake path, tagged so the Lead replies in "chat mode" — conversationally, in
  one comment — rather than running its full task sweep. (Phase 3–4)
- **Chat resolves to real work.** When a conversation calls for it, the Squad Lead turns it into
  a real object: an **issue**, a **plan** (a parent issue with child steps), an **approval**, or
  a **decision** — each linked back to the Lead thread. (Phase 5–6)
- **Decisions are first-class and acknowledged.** A new `lead_decision` interaction records a
  leadership decision (title, rationale, impact, options, chosen) that the operator acknowledges
  via `POST /api/issues/:id/interactions/:interactionId/acknowledge`. (Phase 5)
- **An entry point for the UI.** `GET /api/squads/:squadId/lead-thread` lazily creates and
  returns the Lead thread plus a summary of the Squad Lead that hosts it. (Phase 7)

## Reliability & governance

Squad Lead Chat rides the existing execution loop, so it inherits Slaw's reliability and cost
controls: the instance circuit breaker pauses chat on shared-account exhaustion, quiescence stands
the Lead down when there's nothing to answer, the wake-cycle guard is reset on each human message
so a genuine reply always re-wakes the Lead, and the prompt budget bounds long threads. Every
message, reply, decision, approval, and plan is a first-class, attributable object under the
existing operator governance and audit model — chat adds no ungoverned surface.

## Build progress

- [x] Phase 1 — `issues.thread_type` column + migration 0099 + task-surface exclusions
- [x] Phase 2 — `getOrCreateLeadThread` service (one durable Lead thread per squad)
- [x] Phase 3 — wake routing: user chat message wakes the Squad Lead (`lead_chat`, F3-safe)
- [x] Phase 4 — Squad Lead chat-mode operating instructions
- [x] Phase 5 — `lead_decision` interaction + acknowledge endpoint
- [x] Phase 6 — the four chat outcomes wired to real endpoints (issue/plan/approval/decision)
- [x] Phase 7 — `GET /api/squads/:squadId/lead-thread` endpoint
- [ ] Phase 8 — chat UI ("Talk to your Squad Lead" panel)
- [ ] Phase 9 — inline outcome cards (issue/plan/approval/decision)
- [ ] Phase 10 — reliability verification (F1/F3/F5)
- [ ] Phase 11 — docs portal + marketing + trackers (finalize this note as the release)

## Notes

- There is no `issues.metadata` column; outcomes link to the Lead thread via `parentId`
  (and approvals via `issueIds`). An outcome issue is a normal `thread_type = 'issue'` task and
  appears on the board; only the Lead thread itself is excluded.
- The docs portal page (`operate/squad-lead-chat`) is published as a **preview** and will be
  finalized in Phase 11.
