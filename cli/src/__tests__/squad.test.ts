import { describe, expect, it } from "vitest";
import type { SquadPortabilityPreviewResult } from "@slaw/shared";
import {
  buildSquadDashboardUrl,
  buildDefaultImportAdapterOverrides,
  buildDefaultImportSelectionState,
  buildImportSelectionCatalog,
  buildSelectedFilesFromImportSelection,
  renderSquadImportPreview,
  renderSquadImportResult,
  resolveSquadImportApplyConfirmationMode,
  resolveSquadImportApiPath,
} from "../commands/client/squad.js";

describe("resolveSquadImportApiPath", () => {
  it("uses squad-scoped preview route for existing-squad dry runs", () => {
    expect(
      resolveSquadImportApiPath({
        dryRun: true,
        targetMode: "existing_squad",
        squadId: "squad-123",
      }),
    ).toBe("/api/squads/squad-123/imports/preview");
  });

  it("uses squad-scoped apply route for existing-squad imports", () => {
    expect(
      resolveSquadImportApiPath({
        dryRun: false,
        targetMode: "existing_squad",
        squadId: "squad-123",
      }),
    ).toBe("/api/squads/squad-123/imports/apply");
  });

  it("keeps global routes for new-squad imports", () => {
    expect(
      resolveSquadImportApiPath({
        dryRun: true,
        targetMode: "new_squad",
      }),
    ).toBe("/api/squads/import/preview");

    expect(
      resolveSquadImportApiPath({
        dryRun: false,
        targetMode: "new_squad",
      }),
    ).toBe("/api/squads/import");
  });

  it("throws when an existing-squad import is missing a squad id", () => {
    expect(() =>
      resolveSquadImportApiPath({
        dryRun: true,
        targetMode: "existing_squad",
        squadId: " ",
      })
    ).toThrow(/require a squadId/i);
  });
});

describe("resolveSquadImportApplyConfirmationMode", () => {
  it("skips confirmation when --yes is set", () => {
    expect(
      resolveSquadImportApplyConfirmationMode({
        yes: true,
        interactive: false,
        json: false,
      }),
    ).toBe("skip");
  });

  it("prompts in interactive text mode when --yes is not set", () => {
    expect(
      resolveSquadImportApplyConfirmationMode({
        yes: false,
        interactive: true,
        json: false,
      }),
    ).toBe("prompt");
  });

  it("requires --yes for non-interactive apply", () => {
    expect(() =>
      resolveSquadImportApplyConfirmationMode({
        yes: false,
        interactive: false,
        json: false,
      })
    ).toThrow(/non-interactive terminal requires --yes/i);
  });

  it("requires --yes for json apply", () => {
    expect(() =>
      resolveSquadImportApplyConfirmationMode({
        yes: false,
        interactive: false,
        json: true,
      })
    ).toThrow(/with --json requires --yes/i);
  });
});

describe("buildSquadDashboardUrl", () => {
  it("preserves the configured base path when building a dashboard URL", () => {
    expect(buildSquadDashboardUrl("https://slaw.example/app/", "PAP")).toBe(
      "https://slaw.example/app/PAP/dashboard",
    );
  });
});

describe("renderSquadImportPreview", () => {
  it("summarizes the preview with counts, selection info, and truncated examples", () => {
    const preview: SquadPortabilityPreviewResult = {
      include: {
        squad: true,
        agents: true,
        projects: true,
        issues: true,
        skills: true,
      },
      targetSquadId: "squad-123",
      targetSquadName: "Imported Co",
      collisionStrategy: "rename",
      selectedAgentSlugs: ["squad_lead", "cto", "eng-1", "eng-2", "eng-3", "eng-4", "eng-5"],
      plan: {
        squadAction: "update",
        agentPlans: [
          { slug: "squad_lead", action: "create", plannedName: "Squad Lead", existingAgentId: null, reason: null },
          { slug: "cto", action: "update", plannedName: "CTO", existingAgentId: "agent-2", reason: "replace strategy" },
          { slug: "eng-1", action: "skip", plannedName: "Engineer 1", existingAgentId: "agent-3", reason: "skip strategy" },
          { slug: "eng-2", action: "create", plannedName: "Engineer 2", existingAgentId: null, reason: null },
          { slug: "eng-3", action: "create", plannedName: "Engineer 3", existingAgentId: null, reason: null },
          { slug: "eng-4", action: "create", plannedName: "Engineer 4", existingAgentId: null, reason: null },
          { slug: "eng-5", action: "create", plannedName: "Engineer 5", existingAgentId: null, reason: null },
        ],
        projectPlans: [
          { slug: "alpha", action: "create", plannedName: "Alpha", existingProjectId: null, reason: null },
        ],
        issuePlans: [
          { slug: "kickoff", action: "create", plannedTitle: "Kickoff", reason: null },
        ],
      },
      manifest: {
        schemaVersion: 1,
        generatedAt: "2026-03-23T17:00:00.000Z",
        source: {
          squadId: "squad-src",
          squadName: "Source Co",
        },
        includes: {
          squad: true,
          agents: true,
          projects: true,
          issues: true,
          skills: true,
        },
        squad: {
          path: "SQUAD.md",
          name: "Source Co",
          description: null,
          attachmentMaxBytes: null,
          brandColor: null,
          logoPath: null,
          requireBoardApprovalForNewAgents: false,
          feedbackDataSharingEnabled: false,
          feedbackDataSharingConsentAt: null,
          feedbackDataSharingConsentByUserId: null,
          feedbackDataSharingTermsVersion: null,
        },
        sidebar: {
          agents: ["squad_lead"],
          projects: ["alpha"],
        },
        agents: [
          {
            slug: "squad_lead",
            name: "Squad Lead",
            path: "agents/squad_lead/AGENT.md",
            skills: [],
            role: "squad_lead",
            title: null,
            icon: null,
            capabilities: null,
            reportsToSlug: null,
            adapterType: "codex_local",
            adapterConfig: {},
            runtimeConfig: {},
            permissions: {},
            budgetMonthlyCents: 0,
            metadata: null,
          },
        ],
        skills: [
          {
            key: "skill-a",
            slug: "skill-a",
            name: "Skill A",
            path: "skills/skill-a/SKILL.md",
            description: null,
            sourceType: "inline",
            sourceLocator: null,
            sourceRef: null,
            trustLevel: null,
            compatibility: null,
            metadata: null,
            fileInventory: [],
          },
        ],
        projects: [
          {
            slug: "alpha",
            name: "Alpha",
            path: "projects/alpha/PROJECT.md",
            description: null,
            ownerAgentSlug: null,
            leadAgentSlug: null,
            targetDate: null,
            color: null,
            status: null,
            executionWorkspacePolicy: null,
            workspaces: [],
            env: null,
            metadata: null,
          },
        ],
        issues: [
          {
            slug: "kickoff",
            identifier: null,
            title: "Kickoff",
            path: "projects/alpha/issues/kickoff/TASK.md",
            projectSlug: "alpha",
            projectWorkspaceKey: null,
            assigneeAgentSlug: "squad_lead",
            description: null,
            recurring: false,
            routine: null,
            legacyRecurrence: null,
            status: null,
            priority: null,
            labelIds: [],
            billingCode: null,
            executionWorkspaceSettings: null,
            assigneeAdapterOverrides: null,
            comments: [],
            metadata: null,
          },
        ],
        envInputs: [
          {
            key: "OPENAI_API_KEY",
            description: null,
            agentSlug: "squad_lead",
            projectSlug: null,
            kind: "secret",
            requirement: "required",
            defaultValue: null,
            portability: "portable",
          },
        ],
      },
      files: {
        "SQUAD.md": "# Source Co",
      },
      envInputs: [
        {
          key: "OPENAI_API_KEY",
          description: null,
          agentSlug: "squad_lead",
          projectSlug: null,
          kind: "secret",
          requirement: "required",
          defaultValue: null,
          portability: "portable",
        },
      ],
      warnings: ["One warning"],
      errors: ["One error"],
    };

    const rendered = renderSquadImportPreview(preview, {
      sourceLabel: "GitHub: https://github.com/slaw/squads/demo",
      targetLabel: "Imported Co (squad-123)",
      infoMessages: ["Using claude-local adapter"],
    });

    expect(rendered).toContain("Include");
    expect(rendered).toContain("squad, projects, tasks, agents, skills");
    expect(rendered).toContain("7 agents total");
    expect(rendered).toContain("1 project total");
    expect(rendered).toContain("1 task total");
    expect(rendered).toContain("skills: 1 skill packaged");
    expect(rendered).toContain("+1 more");
    expect(rendered).toContain("Using claude-local adapter");
    expect(rendered).toContain("Warnings");
    expect(rendered).toContain("Errors");
  });
});

describe("renderSquadImportResult", () => {
  it("summarizes import results with created, updated, and skipped counts", () => {
    const rendered = renderSquadImportResult(
      {
        squad: {
          id: "squad-123",
          name: "Imported Co",
          action: "updated",
        },
        agents: [
          { slug: "squad_lead", id: "agent-1", action: "created", name: "Squad Lead", reason: null },
          { slug: "cto", id: "agent-2", action: "updated", name: "CTO", reason: "replace strategy" },
          { slug: "ops", id: null, action: "skipped", name: "Ops", reason: "skip strategy" },
        ],
        projects: [
          { slug: "app", id: "project-1", action: "created", name: "App", reason: null },
          { slug: "ops", id: "project-2", action: "updated", name: "Operations", reason: "replace strategy" },
          { slug: "archive", id: null, action: "skipped", name: "Archive", reason: "skip strategy" },
        ],
        envInputs: [],
        warnings: ["Review API keys"],
      },
      {
        targetLabel: "Imported Co (squad-123)",
        squadUrl: "https://slaw.example/PAP/dashboard",
        infoMessages: ["Using claude-local adapter"],
      },
    );

    expect(rendered).toContain("Squad");
    expect(rendered).toContain("https://slaw.example/PAP/dashboard");
    expect(rendered).toContain("3 agents total (1 created, 1 updated, 1 skipped)");
    expect(rendered).toContain("3 projects total (1 created, 1 updated, 1 skipped)");
    expect(rendered).toContain("Agent results");
    expect(rendered).toContain("Project results");
    expect(rendered).toContain("Using claude-local adapter");
    expect(rendered).toContain("Review API keys");
  });
});

describe("import selection catalog", () => {
  it("defaults to everything and keeps project selection separate from task selection", () => {
    const preview: SquadPortabilityPreviewResult = {
      include: {
        squad: true,
        agents: true,
        projects: true,
        issues: true,
        skills: true,
      },
      targetSquadId: "squad-123",
      targetSquadName: "Imported Co",
      collisionStrategy: "rename",
      selectedAgentSlugs: ["squad_lead"],
      plan: {
        squadAction: "create",
        agentPlans: [],
        projectPlans: [],
        issuePlans: [],
      },
      manifest: {
        schemaVersion: 1,
        generatedAt: "2026-03-23T18:00:00.000Z",
        source: {
          squadId: "squad-src",
          squadName: "Source Co",
        },
        includes: {
          squad: true,
          agents: true,
          projects: true,
          issues: true,
          skills: true,
        },
        squad: {
          path: "SQUAD.md",
          name: "Source Co",
          description: null,
          attachmentMaxBytes: null,
          brandColor: null,
          logoPath: "images/squad-logo.png",
          requireBoardApprovalForNewAgents: false,
          feedbackDataSharingEnabled: false,
          feedbackDataSharingConsentAt: null,
          feedbackDataSharingConsentByUserId: null,
          feedbackDataSharingTermsVersion: null,
        },
        sidebar: {
          agents: ["squad_lead"],
          projects: ["alpha"],
        },
        agents: [
          {
            slug: "squad_lead",
            name: "Squad Lead",
            path: "agents/squad_lead/AGENT.md",
            skills: [],
            role: "squad_lead",
            title: null,
            icon: null,
            capabilities: null,
            reportsToSlug: null,
            adapterType: "codex_local",
            adapterConfig: {},
            runtimeConfig: {},
            permissions: {},
            budgetMonthlyCents: 0,
            metadata: null,
          },
        ],
        skills: [
          {
            key: "skill-a",
            slug: "skill-a",
            name: "Skill A",
            path: "skills/skill-a/SKILL.md",
            description: null,
            sourceType: "inline",
            sourceLocator: null,
            sourceRef: null,
            trustLevel: null,
            compatibility: null,
            metadata: null,
            fileInventory: [{ path: "skills/skill-a/helper.md", kind: "doc" }],
          },
        ],
        projects: [
          {
            slug: "alpha",
            name: "Alpha",
            path: "projects/alpha/PROJECT.md",
            description: null,
            ownerAgentSlug: null,
            leadAgentSlug: null,
            targetDate: null,
            color: null,
            status: null,
            executionWorkspacePolicy: null,
            workspaces: [],
            env: null,
            metadata: null,
          },
        ],
        issues: [
          {
            slug: "kickoff",
            identifier: null,
            title: "Kickoff",
            path: "projects/alpha/issues/kickoff/TASK.md",
            projectSlug: "alpha",
            projectWorkspaceKey: null,
            assigneeAgentSlug: "squad_lead",
            description: null,
            recurring: false,
            routine: null,
            legacyRecurrence: null,
            status: null,
            priority: null,
            labelIds: [],
            billingCode: null,
            executionWorkspaceSettings: null,
            assigneeAdapterOverrides: null,
            comments: [],
            metadata: null,
          },
        ],
        envInputs: [],
      },
      files: {
        "SQUAD.md": "# Source Co",
        "README.md": "# Readme",
        ".slaw.yaml": "schema: slaw/v1\n",
        "images/squad-logo.png": {
          encoding: "base64",
          data: "",
          contentType: "image/png",
        },
        "projects/alpha/PROJECT.md": "# Alpha",
        "projects/alpha/notes.md": "project notes",
        "projects/alpha/issues/kickoff/TASK.md": "# Kickoff",
        "projects/alpha/issues/kickoff/details.md": "task details",
        "agents/squad_lead/AGENT.md": "# Squad Lead",
        "agents/squad_lead/prompt.md": "prompt",
        "skills/skill-a/SKILL.md": "# Skill A",
        "skills/skill-a/helper.md": "helper",
      },
      envInputs: [],
      warnings: [],
      errors: [],
    };

    const catalog = buildImportSelectionCatalog(preview);
    const state = buildDefaultImportSelectionState(catalog);

    expect(state.squad).toBe(true);
    expect(state.projects.has("alpha")).toBe(true);
    expect(state.issues.has("kickoff")).toBe(true);
    expect(state.agents.has("squad_lead")).toBe(true);
    expect(state.skills.has("skill-a")).toBe(true);

    state.squad = false;
    state.issues.clear();
    state.agents.clear();
    state.skills.clear();

    const selectedFiles = buildSelectedFilesFromImportSelection(catalog, state);

    expect(selectedFiles).toContain(".slaw.yaml");
    expect(selectedFiles).toContain("projects/alpha/PROJECT.md");
    expect(selectedFiles).toContain("projects/alpha/notes.md");
    expect(selectedFiles).not.toContain("projects/alpha/issues/kickoff/TASK.md");
    expect(selectedFiles).not.toContain("projects/alpha/issues/kickoff/details.md");
  });
});

describe("default adapter overrides", () => {
  it("maps process-only imported agents to claude_local", () => {
    const preview: SquadPortabilityPreviewResult = {
      include: {
        squad: false,
        agents: true,
        projects: false,
        issues: false,
        skills: false,
      },
      targetSquadId: null,
      targetSquadName: null,
      collisionStrategy: "rename",
      selectedAgentSlugs: ["legacy-agent", "explicit-agent"],
      plan: {
        squadAction: "none",
        agentPlans: [],
        projectPlans: [],
        issuePlans: [],
      },
      manifest: {
        schemaVersion: 1,
        generatedAt: "2026-03-23T18:20:00.000Z",
        source: null,
        includes: {
          squad: false,
          agents: true,
          projects: false,
          issues: false,
          skills: false,
        },
        squad: null,
        sidebar: null,
        agents: [
          {
            slug: "legacy-agent",
            name: "Legacy Agent",
            path: "agents/legacy-agent/AGENT.md",
            skills: [],
            role: "agent",
            title: null,
            icon: null,
            capabilities: null,
            reportsToSlug: null,
            adapterType: "process",
            adapterConfig: {},
            runtimeConfig: {},
            permissions: {},
            budgetMonthlyCents: 0,
            metadata: null,
          },
          {
            slug: "explicit-agent",
            name: "Explicit Agent",
            path: "agents/explicit-agent/AGENT.md",
            skills: [],
            role: "agent",
            title: null,
            icon: null,
            capabilities: null,
            reportsToSlug: null,
            adapterType: "codex_local",
            adapterConfig: {},
            runtimeConfig: {},
            permissions: {},
            budgetMonthlyCents: 0,
            metadata: null,
          },
        ],
        skills: [],
        projects: [],
        issues: [],
        envInputs: [],
      },
      files: {},
      envInputs: [],
      warnings: [],
      errors: [],
    };

    expect(buildDefaultImportAdapterOverrides(preview)).toEqual({
      "legacy-agent": {
        adapterType: "claude_local",
      },
    });
  });
});
