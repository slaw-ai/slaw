<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="https://slaw.ing/docs"><strong>Docs</strong></a> &middot;
  <a href="https://github.com/theferozbasha/slaw"><strong>GitHub</strong></a> &middot;
  <a href="https://discord.gg/m4HZY7xNG3"><strong>Discord</strong></a> &middot;
  <a href="https://x.com/slawing"><strong>Twitter</strong></a> &middot;
  <a href="https://slaw.ing"><strong>Website</strong></a>
</p>

<br/>

# SLAW — Simple Localised Agent Workforce

Open-source orchestration for a simple, localised workforce of AI agents.

**If an agent is an _employee_, SLAW is the _squad_.**

Slaw is a Node.js server and React UI that orchestrates a team of AI agents to run a business. Bring your own agents, assign goals, and track work and costs from one dashboard.

It looks like a task manager. Under the hood: org charts, budgets, governance, goal alignment, and agent coordination.

**Manage business goals, not pull requests.**

|        | Step            | Example                                                            |
| ------ | --------------- | ------------------------------------------------------------------ |
| **01** | Define the goal | _"Build the #1 AI note-taking app to $1M MRR."_                    |
| **02** | Hire the team   | Squad Lead, discipline leads, engineers, designers, marketers — any bot, any provider. |
| **03** | Approve and run | Review strategy. Set budgets. Hit go. Monitor from the dashboard.  |

<br/>

<div align="center">
<table>
  <tr>
    <td align="center"><strong>Works<br/>with</strong></td>
    <td align="center"><img src="doc/assets/logos/claude.svg" width="32" alt="Claude" /><br/><sub>Claude Code</sub></td>
    <td align="center"><img src="doc/assets/logos/codex.svg" width="32" alt="Codex" /><br/><sub>Codex</sub></td>
    <td align="center"><img src="doc/assets/logos/cursor.svg" width="32" alt="Cursor" /><br/><sub>Cursor</sub></td>
    <td align="center"><img src="doc/assets/logos/bash.svg" width="32" alt="Bash" /><br/><sub>Bash</sub></td>
    <td align="center"><img src="doc/assets/logos/http.svg" width="32" alt="HTTP" /><br/><sub>HTTP</sub></td>
  </tr>
</table>

<em>If it can receive a heartbeat, it's hired.</em>

</div>

<br/>

## Slaw is right for you if

- ✅ You want to build **autonomous AI squads**
- ✅ You **coordinate many different agents** (Codex, Claude, Cursor) toward a common goal
- ✅ You have **20 simultaneous Claude Code terminals** open and lose track of what everyone is doing
- ✅ You want agents running **autonomously 24/7**, but still want to audit work and chime in when needed
- ✅ You want to **monitor costs** and enforce budgets
- ✅ You want a process for managing agents that **feels like using a task manager**
- ✅ You want to manage your autonomous businesses **from your phone**

<br/>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🔌 Bring Your Own Agent</h3>
Any agent, any runtime, one org chart. If it can receive a heartbeat, it's hired.
</td>
<td align="center" width="33%">
<h3>🎯 Goal Alignment</h3>
Every task traces back to the squad mission. Agents know <em>what</em> to do and <em>why</em>.
</td>
<td align="center" width="33%">
<h3>💓 Heartbeats</h3>
Agents wake on a schedule, check work, and act. Delegation flows up and down the org chart.
</td>
</tr>
<tr>
<td align="center">
<h3>💰 Cost Control</h3>
Monthly budgets per agent. When they hit the limit, they stop. No runaway costs.
</td>
<td align="center">
<h3>🏢 Multi-Squad</h3>
One deployment, many squads. Complete data isolation. One control plane for your portfolio.
</td>
<td align="center">
<h3>🎫 Ticket System</h3>
Every conversation traced. Every decision explained. Full tool-call tracing and immutable audit log.
</td>
</tr>
<tr>
<td align="center">
<h3>🛡️ Governance</h3>
Approve hires, override strategy, pause or terminate any agent — at any time.
</td>
<td align="center">
<h3>📊 Org Chart</h3>
Hierarchies, roles, reporting lines. Your agents have a boss, a title, and a job description.
</td>
<td align="center">
<h3>📱 Mobile Ready</h3>
Monitor and manage your autonomous businesses from anywhere.
</td>
</tr>
</table>

<br/>

## Problems Slaw solves

| Without Slaw                                                                                                                     | With Slaw                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ❌ You have 20 Claude Code tabs open and can't track which one does what. On reboot you lose everything.                              | ✅ Tasks are ticket-based, conversations are threaded, sessions persist across reboots.                                                |
| ❌ You manually gather context from several places to remind your bot what you're actually doing.                                     | ✅ Context flows from the task up through the project and squad goals — your agent always knows what to do and why.                  |
| ❌ Folders of agent configs are disorganized and you're re-inventing task management, communication, and coordination between agents. | ✅ Slaw gives you org charts, ticketing, delegation, and governance out of the box — so you run a squad, not a pile of scripts. |
| ❌ Runaway loops waste hundreds of dollars of tokens and max your quota before you even know what happened.                           | ✅ Cost tracking surfaces token budgets and throttles agents when they're out. Management prioritizes with budgets.                    |
| ❌ You have recurring jobs (customer support, social, reports) and have to remember to manually kick them off.                        | ✅ Heartbeats handle regular work on a schedule. Management supervises.                                                                |
| ❌ You have an idea, you have to find your repo, fire up Claude Code, keep a tab open, and babysit it.                                | ✅ Add a task in Slaw. Your coding agent works on it until it's done. Management reviews their work.                              |

<br/>

## Why Slaw is special

Slaw handles the hard orchestration details correctly.

|                                   |                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Atomic execution.**             | Task checkout and budget enforcement are atomic, so no double-work and no runaway spend.                      |
| **Persistent agent state.**       | Agents resume the same task context across heartbeats instead of restarting from scratch.                     |
| **Runtime skill injection.**      | Agents can learn Slaw workflows and project context at runtime, without retraining.                      |
| **Governance with rollback.**     | Approval gates are enforced, config changes are revisioned, and bad changes can be rolled back safely.        |
| **Goal-aware execution.**         | Tasks carry full goal ancestry so agents consistently see the "why," not just a title.                        |
| **Portable squad templates.**   | Export/import orgs, agents, and skills with secret scrubbing and collision handling.                          |
| **True multi-squad isolation.** | Every entity is squad-scoped, so one deployment can run many squads with separate data and audit trails. |

<br/>

## What's Under the Hood

Slaw is a full control plane, not a wrapper. Before you build any of this yourself, know that it already exists:

```
┌──────────────────────────────────────────────────────────────┐
│                       SLAW SERVER                       │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │Identity & │  │  Work &   │  │ Heartbeat │  │Governance │  │
│  │  Access   │  │   Tasks   │  │ Execution │  │& Approvals│  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Org Chart │  │Workspaces │  │  Plugins  │  │  Budget   │  │
│  │ & Agents  │  │ & Runtime │  │           │  │ & Costs   │  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Routines  │  │ Secrets & │  │ Activity  │  │  Squad  │  │
│  │& Schedules│  │  Storage  │  │ & Events  │  │Portability│  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
└──────────────────────────────────────────────────────────────┘
         ▲              ▲              ▲              ▲
   ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
   │  Claude   │  │   Codex   │  │   CLI     │  │ HTTP/web  │
   │   Code    │  │           │  │  agents   │  │   bots    │
   └───────────┘  └───────────┘  └───────────┘  └───────────┘
```

### The Systems

<table>
<tr>
<td width="50%">

**Identity & Access** — Two deployment modes (trusted local or authenticated), board users, agent API keys, short-lived run JWTs, squad memberships, invite flows, and agent onboarding. Every mutating request is traced to an actor.

</td>
<td width="50%">

**Org Chart & Agents** — Agents have roles, titles, reporting lines, permissions, and budgets. Adapter examples match the diagram: Claude Code, Codex, CLI agents such as Cursor/Gemini/bash, HTTP/webhook bots, and external adapter plugins. If it can receive a heartbeat, it's hired.

</td>
</tr>
<tr>
<td>

**Work & Task System** — Issues carry squad/project/goal/parent links, atomic checkout with execution locks, first-class blocker dependencies, comments, documents, attachments, work products, labels, and inbox state. No double-work, no lost context.

</td>
<td>

**Heartbeat Execution** — DB-backed wakeup queue with coalescing, budget checks, workspace resolution, secret injection, skill loading, and adapter invocation. Runs produce structured logs, cost events, session state, and audit trails. Recovery handles orphaned runs automatically.

</td>
</tr>
<tr>
<td>

**Workspaces & Runtime** — Project workspaces, isolated execution workspaces (git worktrees, operator branches), and runtime services (dev servers, preview URLs). Agents work in the right directory with the right context every time.

</td>
<td>

**Governance & Approvals** — Board approval workflows, execution policies with review/approval stages, decision tracking, budget hard-stops, agent pause/resume/terminate, and full audit logging. Nothing ships without your sign-off.

</td>
</tr>
<tr>
<td>

**Budget & Cost Control** — Token and cost tracking by squad, agent, project, goal, issue, provider, and model. Scoped budget policies with warning thresholds and hard stops. Overspend pauses agents and cancels queued work automatically.

</td>
<td>

**Routines & Schedules** — Recurring tasks with cron, webhook, and API triggers. Concurrency and catch-up policies. Each routine execution creates a tracked issue and wakes the assigned agent — no manual kick-offs needed.

</td>
</tr>
<tr>
<td>

**Plugins** — Instance-wide plugin system with out-of-process workers, capability-gated host services, job scheduling, tool exposure, and UI contributions. Extend Slaw without forking it. Ships with first-party integrations like **Jira Sync** (bidirectional Jira board ↔ Slaw issue sync).

</td>
<td>

**Secrets & Storage** — Instance and squad secrets, encrypted local storage, provider-backed object storage, attachments, and work products. Sensitive values stay out of prompts unless a scoped run explicitly needs them.

</td>
</tr>
<tr>
<td>

**Activity & Events** — Mutating actions, heartbeat state changes, cost events, approvals, comments, and work products are recorded as durable activity so operators can audit what happened and why.

</td>
<td>

**Squad Portability** — Export and import entire organizations — agents, skills, projects, routines, and issues — with secret scrubbing and collision handling. One deployment, many squads, complete data isolation.

</td>
</tr>
</table>

<br/>

## What Slaw is not

|                              |                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Not a chatbot.**           | Agents have jobs, not chat windows.                                                                                  |
| **Not an agent framework.**  | We don't tell you how to build agents. We tell you how to run a squad made of them.                                |
| **Not a workflow builder.**  | No drag-and-drop pipelines. Slaw models squads — with org charts, goals, budgets, and governance.            |
| **Not a prompt manager.**    | Agents bring their own prompts, models, and runtimes. Slaw manages the organization they work in.               |
| **Not a single-agent tool.** | This is for teams. If you have one agent, you probably don't need Slaw. If you have twenty — you definitely do. |
| **Not a code review tool.**  | Slaw orchestrates work, not pull requests. Bring your own review process.                                       |

<br/>

## Quickstart

Open source. Self-hosted. No Slaw account required.

```bash
npx slaw onboard --yes
```

That quickstart path now defaults to trusted local loopback mode for the fastest first run. To start in authenticated/private mode instead, choose a bind preset explicitly:

```bash
npx slaw onboard --yes --bind lan
# or:
npx slaw onboard --yes --bind tailnet
```

If you already have Slaw configured, rerunning `onboard` keeps the existing config in place. Use `slaw configure` to edit settings.

Or manually:

```bash
git clone https://github.com/theferozbasha/slaw.git
cd slaw
pnpm install
pnpm dev
```

This starts the API server at `http://localhost:3100`. An embedded PostgreSQL database is created automatically — no setup required.

> **Requirements:** Node.js 20+, pnpm 9.15+

<br/>

## FAQ

**What does a typical setup look like?**
Locally, a single Node.js process manages an embedded Postgres and local file storage. For production, point it at your own Postgres and deploy however you like. Configure projects, agents, and goals — the agents take care of the rest.

If you're a solo entrepreneur you can use Tailscale to access Slaw on the go. Then later you can deploy to e.g. Vercel when you need it.

**Can I run multiple squads?**
Yes. A single deployment can run an unlimited number of squads with complete data isolation.

**How is Slaw different from agents like Claude Code?**
Slaw _uses_ those agents. It orchestrates them into a squad — with org charts, budgets, goals, governance, and accountability.

**Why should I use Slaw instead of just pointing my agent to Asana or Trello?**
Agent orchestration has subtleties in how you coordinate who has work checked out, how to maintain sessions, monitoring costs, establishing governance - Slaw does this for you.

(Bring-your-own-ticket-system is on the Roadmap)

**Do agents run continuously?**
By default, agents run on scheduled heartbeats and event-based triggers (task assignment, @-mentions). You can also hook in continuous agents. You bring your agent and Slaw coordinates.

<br/>

## Development

```bash
pnpm dev              # Full dev (API + UI, watch mode)
pnpm dev:once         # Full dev without file watching
pnpm dev:server       # Server only
pnpm build            # Build all
pnpm typecheck        # Type checking
pnpm test             # Cheap default test run (Vitest only)
pnpm test:watch       # Vitest watch mode
pnpm test:e2e         # Playwright browser suite
pnpm db:generate      # Generate DB migration
pnpm db:migrate       # Apply migrations
```

`pnpm test` does not run Playwright. Browser suites stay separate and are typically run only when working on those flows or in CI.

See [doc/DEVELOPING.md](doc/DEVELOPING.md) for the full development guide.

<br/>

## Roadmap

- ✅ Plugin system (e.g. add a knowledge base, custom tracing, queues, etc)
- ✅ Get continuous agent employees
- ✅ squads.sh - import and export entire organizations
- ✅ Easy AGENTS.md configurations
- ✅ Skills Manager
- ✅ Scheduled Routines
- ✅ Better Budgeting
- ✅ Agent Reviews and Approvals
- ✅ Multiple Human Users
- ⚪ Cloud / Sandbox agents (e.g. Cursor / e2b agents)
- ⚪ Artifacts & Work Products
- ⚪ Memory / Knowledge
- ⚪ Enforced Outcomes
- ⚪ MAXIMIZER MODE
- ⚪ Deep Planning
- ⚪ Work Queues
- ⚪ Self-Organization
- ⚪ Automatic Organizational Learning
- ⚪ Squad Lead Chat
- ⚪ Cloud deployments
- ⚪ Desktop App

This is the short roadmap preview. See the full roadmap in [ROADMAP.md](ROADMAP.md).

<br/>

## Community & Plugins

Find Plugins and more at [awesome-slaw](https://github.com/gsxdsm/awesome-slaw)

**Bundled plugins** live under `packages/plugins/` and are auto-discovered at startup. Notably:

- **Jira Sync** (`@slaw/plugin-jira-sync`) — connects one Jira board to a squad. Mirrors Jira issues
  into Slaw (real-time webhook + hourly reconcile) and reflects Slaw completion back to Jira. Install
  it into a squad, point it at a board, and it provisions a sync agent and an hourly routine for you.
  See `packages/plugins/jira-sync/README.md`.

## Telemetry

Slaw collects anonymous usage telemetry to help us understand how the product is used and improve it. No personal information, issue content, prompts, file paths, or secrets are ever collected. Private repository references are hashed with a per-install salt before being sent.

Telemetry is **enabled by default** and can be disabled with any of the following:

| Method               | How                                                     |
| -------------------- | ------------------------------------------------------- |
| Environment variable | `SLAW_TELEMETRY_DISABLED=1`                        |
| Standard convention  | `DO_NOT_TRACK=1`                                        |
| CI environments      | Automatically disabled when `CI=true`                   |
| Config file          | Set `telemetry.enabled: false` in your Slaw config |

## Contributing

We welcome contributions. See the [contributing guide](CONTRIBUTING.md) for details.

<br/>

## Community

- [Discord](https://discord.gg/m4HZY7xNG3) — Join the community
- [Twitter / X](https://x.com/slawing) — Follow updates and announcements
- [GitHub Issues](https://github.com/theferozbasha/slaw/issues) — bugs and feature requests
- [GitHub Discussions](https://github.com/theferozbasha/slaw/discussions) — ideas and RFC

<br/>

## License

MIT &copy; 2026 [Slaw Labs, Inc](https://slaw.ing)

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=theferozbasha/slaw&type=date&legend=top-left)](https://www.star-history.com/?repos=theferozbasha%2Fslaw&type=date&legend=top-left)

<br/>

---

<p align="center">
  <sub>Open source under MIT. Built for people who want to get work done, not babysit agents.</sub>
</p>
