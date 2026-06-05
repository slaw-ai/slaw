# Agent Squads Spec Inventory

This document indexes every part of the Slaw codebase that touches the [Agent Squads Specification](docs/squads/squads-spec.md) (`agentsquads/v1-draft`).

Use it when you need to:

1. **Update the spec** — know which implementation code must change in lockstep.
2. **Change code that involves the spec** — find all related files quickly.
3. **Keep things aligned** — audit whether implementation matches the spec.

---

## 1. Specification & Design Documents

| File | Role |
|---|---|
| `docs/squads/squads-spec.md` | **Normative spec** — defines the markdown-first package format (SQUAD.md, TEAM.md, AGENTS.md, PROJECT.md, TASK.md, SKILL.md), reserved files, frontmatter schemas, and vendor extension conventions (`.slaw.yaml`). |
| `doc/plans/2026-03-13-squad-import-export-v2.md` | Implementation plan for the markdown-first package model cutover — phases, API changes, UI plan, and rollout strategy. |
| `doc/SPEC-implementation.md` | V1 implementation contract; references the portability system and `.slaw.yaml` sidecar format. |
| `docs/specs/cliphub-plan.md` | Earlier blueprint bundle plan; partially superseded by the markdown-first spec (noted in the v2 plan). |
| `doc/plans/2026-02-16-module-system.md` | Module system plan; JSON-only squad template sections superseded by the markdown-first model. |
| `doc/plans/2026-03-14-skills-ui-product-plan.md` | Skills UI plan; references portable skill files and `.slaw.yaml`. |
| `doc/plans/2026-03-14-adapter-skill-sync-rollout.md` | Adapter skill sync rollout; companion to the v2 import/export plan. |

## 2. Shared Types & Validators

These define the contract between server, CLI, and UI.

| File | What it defines |
|---|---|
| `packages/shared/src/types/squad-portability.ts` | TypeScript interfaces: `SquadPortabilityManifest`, `SquadPortabilityFileEntry`, `SquadPortabilityEnvInput`, export/import/preview request and result types, manifest entry types for agents, skills, projects, issues, recurring routines, squads. |
| `packages/shared/src/validators/squad-portability.ts` | Zod schemas for all portability request/response shapes — used by both server routes and CLI. |
| `packages/shared/src/types/index.ts` | Re-exports portability types. |
| `packages/shared/src/validators/index.ts` | Re-exports portability validators. |

## 3. Server — Services

| File | Responsibility |
|---|---|
| `server/src/services/squad-portability.ts` | **Core portability service.** Export (manifest generation, markdown file emission, `.slaw.yaml` sidecars), import (graph resolution, collision handling, entity creation), preview (planned-action summary). Handles skill key derivation, recurring task <-> routine mapping, legacy recurrence migration, and package README generation. References `agentsquads/v1` version string. |
| `server/src/services/routines.ts` | Slaw routine runtime service. Portability now exports routines as recurring `TASK.md` entries and imports recurring tasks back through this service. |
| `server/src/services/squad-export-readme.ts` | Generates `README.md` and Mermaid org-chart for exported squad packages. |
| `server/src/services/index.ts` | Re-exports `squadPortabilityService`. |

## 4. Server — Routes

| File | Endpoints |
|---|---|
| `server/src/routes/squads.ts` | `POST /api/squads/:squadId/export` — legacy export bundle<br>`POST /api/squads/:squadId/exports/preview` — export preview<br>`POST /api/squads/:squadId/exports` — export package<br>`POST /api/squads/import/preview` — import preview<br>`POST /api/squads/import` — perform import |

Route registration lives in `server/src/app.ts` via `squadRoutes(db, storage)`.

## 5. Server — Tests

| File | Coverage |
|---|---|
| `server/src/__tests__/squad-portability.test.ts` | Unit tests for the portability service (export, import, preview, manifest shape, `agentsquads/v1` version). |
| `server/src/__tests__/squad-portability-routes.test.ts` | Integration tests for the portability HTTP endpoints. |

## 6. CLI

| File | Commands |
|---|---|
| `cli/src/commands/client/squad.ts` | `squad export` — exports a squad package to disk (flags: `--out`, `--include`, `--projects`, `--issues`, `--projectIssues`).<br>`squad import <fromPathOrUrl>` — imports a squad package from a file or folder (flags: positional source path/URL or GitHub shorthand, `--include`, `--target`, `--squadId`, `--newSquadName`, `--agents`, `--collision`, `--ref`, `--dryRun`).<br>Reads/writes portable file entries and handles `.slaw.yaml` filtering. |

## 7. UI — Pages

| File | Role |
|---|---|
| `ui/src/pages/SquadExport.tsx` | Export UI: preview, manifest display, file tree visualization, ZIP archive creation and download. Filters `.slaw.yaml` based on selection. Shows manifest and README in editor. |
| `ui/src/pages/SquadImport.tsx` | Import UI: source input (upload/folder/GitHub URL/generic URL), ZIP reading, preview pane with dependency tree, entity selection checkboxes, trust/licensing warnings, secrets requirements, collision strategy, adapter config. |

## 8. UI — Components

| File | Role |
|---|---|
| `ui/src/components/PackageFileTree.tsx` | Reusable file tree component for both import and export. Builds tree from `SquadPortabilityFileEntry` items, parses frontmatter, shows action indicators (create/update/skip), and maps frontmatter field labels. |

## 9. UI — Libraries

| File | Role |
|---|---|
| `ui/src/lib/portable-files.ts` | Helpers for portable file entries: `getPortableFileText`, `getPortableFileDataUrl`, `getPortableFileContentType`, `isPortableImageFile`. |
| `ui/src/lib/zip.ts` | ZIP archive creation (`createZipArchive`) and reading (`readZipArchive`) — implements ZIP format from scratch for squad packages. CRC32, DOS date/time encoding. |
| `ui/src/lib/zip.test.ts` | Tests for ZIP utilities; exercises round-trip with portability file entries and `.slaw.yaml` content. |

## 10. UI — API Client

| File | Functions |
|---|---|
| `ui/src/api/squads.ts` | `squadsApi.exportBundle`, `squadsApi.exportPreview`, `squadsApi.exportPackage`, `squadsApi.importPreview`, `squadsApi.importBundle` — typed fetch wrappers for the portability endpoints. |

## 11. Skills & Agent Instructions

| File | Relevance |
|---|---|
| `skills/slaw/references/squad-skills.md` | Reference doc for squad skill library workflow — install, inspect, update, assign. Skill packages are a subset of the agent squads spec. |
| `server/src/services/squad-skills.ts` | Squad skill management service — handles SKILL.md-based imports and squad-level skill library. |
| `server/src/services/agent-instructions.ts` | Agent instructions service — resolves AGENTS.md paths for agent instruction loading. |

## 12. Quick Cross-Reference by Spec Concept

| Spec concept | Primary implementation files |
|---|---|
| `SQUAD.md` frontmatter & body | `squad-portability.ts` (export emitter + import parser) |
| `AGENTS.md` frontmatter & body | `squad-portability.ts`, `agent-instructions.ts` |
| `PROJECT.md` frontmatter & body | `squad-portability.ts` |
| `TASK.md` frontmatter & body | `squad-portability.ts` |
| `SKILL.md` packages | `squad-portability.ts`, `squad-skills.ts` |
| `.slaw.yaml` vendor sidecar | `squad-portability.ts`, `routines.ts`, `SquadExport.tsx`, `squad.ts` (CLI) |
| `manifest.json` | `squad-portability.ts` (generation), shared types (schema) |
| ZIP package format | `zip.ts` (UI), `squad.ts` (CLI file I/O) |
| Collision resolution | `squad-portability.ts` (server), `SquadImport.tsx` (UI) |
| Env/secrets declarations | shared types (`SquadPortabilityEnvInput`), `SquadImport.tsx` (UI) |
| README + org chart | `squad-export-readme.ts` |
