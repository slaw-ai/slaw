import { Command } from "commander";
import {
  addCommonClientOptions,
  apiPath,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";

interface SquadOptions extends BaseClientOptions {
  squadId?: string;
}

interface JsonPayloadOptions extends SquadOptions {
  payloadJson?: string;
}

interface QueryOptions extends SquadOptions {
  query?: string;
  status?: string;
  requestType?: string;
  url?: string;
}

export function registerAccessCommands(program: Command): void {
  addWhoamiCommand(program);
  addCommonClientOptions(
    program
      .command("health")
      .description("Check API health")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get("/api/health"), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const access = program.command("access").description("Access and auth inspection operations");
  addWhoamiCommand(access);

  addCommonClientOptions(
    program
      .command("openapi")
      .description("Print the OpenAPI document")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get("/api/openapi.json"), { json: true });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const profile = program.command("profile").description("Current user profile operations");
  addSimpleGet(profile, "session", "Get auth session", "/api/auth/get-session");
  addSimpleGet(profile, "get", "Get current auth profile", "/api/auth/profile");
  addJsonPatch(profile, "update", "Update current auth profile", "/api/auth/profile");
  addCommonClientOptions(
    profile
      .command("squad-user")
      .description("Get a user profile within a squad")
      .argument("<userSlug>", "User slug")
      .option("-C, --squad-id <id>", "Squad ID")
      .action(async (userSlug: string, opts: SquadOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          printOutput(await ctx.api.get(apiPath`/api/squads/${ctx.squadId}/users/${userSlug}/profile`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );

  const invite = program.command("invite").description("Invite operations");
  addSquadList(invite, "list", "List squad invites", "invites");
  addSquadPost(invite, "create", "Create an invite", "invites");
  addCommonClientOptions(
    invite
      .command("revoke")
      .description("Revoke an invite")
      .argument("<inviteId>", "Invite ID")
      .action(async (inviteId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post(apiPath`/api/invites/${inviteId}/revoke`, {}), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  for (const [name, suffix] of [
    ["show", ""],
    ["logo", "logo"],
    ["onboarding", "onboarding"],
    ["onboarding:text", "onboarding.txt"],
    ["skills:index", "skills/index"],
  ] as const) {
    addCommonClientOptions(
      invite
        .command(name)
        .description(`Get invite ${name}`)
        .argument("<token>", "Invite token")
        .action(async (token: string, opts: BaseClientOptions) => {
          try {
            const ctx = resolveCommandContext(opts);
            const path = `${apiPath`/api/invites/${token}`}${suffix ? `/${suffix}` : ""}`;
            printOutput(await ctx.api.get(path), { json: ctx.json });
          } catch (err) {
            handleCommandError(err);
          }
      }),
    );
  }
  addCommonClientOptions(
    invite
      .command("test-resolution")
      .description("Test invite URL resolution")
      .argument("<token>", "Invite token")
      .requiredOption("--url <url>", "URL to test")
      .action(async (token: string, opts: QueryOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const query = new URLSearchParams({ url: opts.url ?? "" });
          printOutput(await ctx.api.get(`${apiPath`/api/invites/${token}/test-resolution`}?${query.toString()}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  addCommonClientOptions(
    invite
      .command("skill")
      .description("Get invite skill markdown")
      .argument("<token>", "Invite token")
      .argument("<skillName>", "Skill name")
      .action(async (token: string, skillName: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get(apiPath`/api/invites/${token}/skills/${skillName}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  addCommonClientOptions(
    invite
      .command("accept")
      .description("Accept an invite")
      .argument("<token>", "Invite token")
      .option("--payload-json <json>", "Invite accept JSON payload", "{}")
      .action(async (token: string, opts: JsonPayloadOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post(apiPath`/api/invites/${token}/accept`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const join = program.command("join").description("Join request operations");
  addCommonClientOptions(
    join
      .command("list")
      .description("List join requests")
      .option("-C, --squad-id <id>", "Squad ID")
      .option("--status <status>", "Filter by status (pending_approval, approved, rejected; pending alias accepted)")
      .option("--request-type <type>", "Filter by request type")
      .action(async (opts: QueryOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const params = new URLSearchParams();
          const status = normalizeJoinStatus(opts.status);
          if (status) params.set("status", status);
          if (opts.requestType) params.set("requestType", opts.requestType);
          const query = params.toString();
          printOutput(await ctx.api.get(`${apiPath`/api/squads/${ctx.squadId}/join-requests`}${query ? `?${query}` : ""}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );
  addJoinAction(join, "approve");
  addJoinAction(join, "reject");
  addCommonClientOptions(
    join
      .command("claim-key")
      .description("Claim an agent API key for an approved join request")
      .argument("<requestId>", "Join request ID")
      .requiredOption("--claim-secret <secret>", "Claim secret")
      .action(async (requestId: string, opts: BaseClientOptions & { claimSecret: string }) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post(apiPath`/api/join-requests/${requestId}/claim-api-key`, { claimSecret: opts.claimSecret }), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const member = program.command("member").description("Squad member operations");
  addSquadList(member, "list", "List squad members", "members");
  addSquadList(member, "user-directory", "List squad user directory", "user-directory");
  addMemberPatch(member, "update", "members");
  addMemberPatch(member, "role-and-grants", "members", "role-and-grants");
  addMemberPatch(member, "permissions", "members", "permissions");
  addMemberPost(member, "archive", "members", "archive");

  const admin = program.command("admin").description("Instance admin operations");
  const user = admin.command("user").description("Admin user operations");
  addCommonClientOptions(
    user
      .command("list")
      .description("List users")
      .option("--query <text>", "Search query")
      .action(async (opts: QueryOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const query = opts.query ? `?${new URLSearchParams({ query: opts.query }).toString()}` : "";
          printOutput(await ctx.api.get(`/api/admin/users${query}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  addAdminUserPost(user, "promote", "promote-instance-admin");
  addAdminUserPost(user, "demote", "demote-instance-admin");
  addCommonClientOptions(
    user
      .command("squad-access")
      .description("Get user squad access")
      .argument("<userId>", "User ID")
      .action(async (userId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get(apiPath`/api/admin/users/${userId}/squad-access`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  addCommonClientOptions(
    user
      .command("squad-access:update")
      .description("Update user squad access")
      .argument("<userId>", "User ID")
      .requiredOption("--payload-json <json>", "UpdateUserSquadAccess JSON payload")
      .action(async (userId: string, opts: JsonPayloadOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.put(apiPath`/api/admin/users/${userId}/squad-access`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const instance = program.command("instance").description("Instance operations");
  addSimpleGet(instance, "scheduler-heartbeats", "List scheduler heartbeat agents", "/api/instance/scheduler-heartbeats");
  addSimpleGet(instance, "settings:general", "Get general instance settings", "/api/instance/settings/general");
  addJsonPatch(instance, "settings:general:update", "Update general instance settings", "/api/instance/settings/general");
  addSimpleGet(instance, "settings:experimental", "Get experimental instance settings", "/api/instance/settings/experimental");
  addJsonPatch(instance, "settings:experimental:update", "Update experimental instance settings", "/api/instance/settings/experimental");
  addCommonClientOptions(
    instance
      .command("database-backup")
      .description("Create a database backup")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post("/api/instance/database-backups", {}), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const sidebar = program.command("sidebar").description("Sidebar preference and badge operations");
  addSimpleGet(sidebar, "preferences", "Get current sidebar preferences", "/api/sidebar-preferences/me");
  addJsonPut(sidebar, "preferences:update", "Update current sidebar preferences", "/api/sidebar-preferences/me");
  addSquadList(sidebar, "project-preferences", "Get current project sidebar preferences", "sidebar-preferences/me");
  addSquadPut(sidebar, "project-preferences:update", "Update current project sidebar preferences", "sidebar-preferences/me");
  addSquadList(sidebar, "badges", "Get sidebar badges", "sidebar-badges");

  const inbox = program.command("inbox").description("Operator inbox operations");
  addSquadList(inbox, "dismissals", "List dismissed inbox items", "inbox-dismissals");
  addSquadPost(inbox, "dismiss", "Dismiss an inbox item", "inbox-dismissals");

  const instanceClaim = program.command("instance-claim").description("Operator claim token operations");
  addCommonClientOptions(
    instanceClaim
      .command("show")
      .description("Inspect a operator claim token")
      .argument("<token>", "Claim token")
      .action(async (token: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get(apiPath`/api/instance-claim/${token}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
  addCommonClientOptions(
    instanceClaim
      .command("claim")
      .description("Claim a operator claim token")
      .argument("<token>", "Claim token")
      .option("--payload-json <json>", "Claim JSON payload", "{}")
      .action(async (token: string, opts: JsonPayloadOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.post(apiPath`/api/instance-claim/${token}/claim`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const publicSkills = program.command("available-skill").description("Public skill catalog operations");
  addSimpleGet(publicSkills, "list", "List available skills", "/api/skills/available");
  addSimpleGet(publicSkills, "index", "Get available skill index", "/api/skills/index");
  addCommonClientOptions(
    publicSkills
      .command("get")
      .description("Get available skill markdown")
      .argument("<skillName>", "Skill name")
      .action(async (skillName: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get(apiPath`/api/skills/${skillName}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  const llm = program.command("llm").description("LLM prompt documentation");
  addSimpleGet(llm, "agent-configuration", "Get agent configuration prompt docs", "/api/llms/agent-configuration.txt");
  addSimpleGet(llm, "agent-icons", "Get agent icon prompt docs", "/api/llms/agent-icons.txt");
  addCommonClientOptions(
    llm
      .command("agent-configuration:adapter")
      .description("Get adapter-specific agent configuration prompt docs")
      .argument("<adapterType>", "Adapter type")
      .action(async (adapterType: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get(`${apiPath`/api/llms/agent-configuration/${adapterType}`}.txt`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}

function addWhoamiCommand(parent: Command): void {
  addCommonClientOptions(
    parent
      .command("whoami")
      .description("Show current CLI auth identity")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          printOutput(await ctx.api.get("/api/cli-auth/me"), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}

function normalizeJoinStatus(status: string | undefined): string | undefined {
  if (status === "pending") return "pending_approval";
  return status;
}

function addSimpleGet(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(parent.command(name).description(description).action(async (opts: BaseClientOptions) => {
    try {
      const ctx = resolveCommandContext(opts);
      printOutput(await ctx.api.get(path), { json: ctx.json });
    } catch (err) {
      handleCommandError(err);
    }
  }));
}

function addJsonPatch(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(parent.command(name).description(description).requiredOption("--payload-json <json>", "JSON payload").action(async (opts: JsonPayloadOptions) => {
    try {
      const ctx = resolveCommandContext(opts);
      printOutput(await ctx.api.patch(path, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
    } catch (err) {
      handleCommandError(err);
    }
  }));
}

function addJsonPut(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(parent.command(name).description(description).requiredOption("--payload-json <json>", "JSON payload").action(async (opts: JsonPayloadOptions) => {
    try {
      const ctx = resolveCommandContext(opts);
      printOutput(await ctx.api.put(path, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
    } catch (err) {
      handleCommandError(err);
    }
  }));
}

function addSquadList(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(
    parent.command(name).description(description).option("-C, --squad-id <id>", "Squad ID").action(async (opts: SquadOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSquad: true });
        printOutput(await ctx.api.get(`${apiPath`/api/squads/${ctx.squadId}`}/${path}`), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSquad: false },
  );
}

function addSquadPut(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(
    parent.command(name).description(description).option("-C, --squad-id <id>", "Squad ID").requiredOption("--payload-json <json>", "JSON payload").action(async (opts: JsonPayloadOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSquad: true });
        printOutput(await ctx.api.put(`${apiPath`/api/squads/${ctx.squadId}`}/${path}`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSquad: false },
  );
}

function addSquadPost(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(
    parent.command(name).description(description).option("-C, --squad-id <id>", "Squad ID").requiredOption("--payload-json <json>", "JSON payload").action(async (opts: JsonPayloadOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSquad: true });
        printOutput(await ctx.api.post(`${apiPath`/api/squads/${ctx.squadId}`}/${path}`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSquad: false },
  );
}

function addJoinAction(parent: Command, action: "approve" | "reject"): void {
  addCommonClientOptions(
    parent.command(action).description(`${action} a join request`).argument("<requestId>", "Join request ID").option("-C, --squad-id <id>", "Squad ID").action(async (requestId: string, opts: SquadOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSquad: true });
        printOutput(await ctx.api.post(`${apiPath`/api/squads/${ctx.squadId}/join-requests/${requestId}`}/${action}`, {}), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSquad: false },
  );
}

function addMemberPatch(parent: Command, name: string, path: string, suffix?: string): void {
  addCommonClientOptions(
    parent.command(name).description(`${name} a member`).argument("<memberId>", "Member ID").option("-C, --squad-id <id>", "Squad ID").requiredOption("--payload-json <json>", "JSON payload").action(async (memberId: string, opts: JsonPayloadOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSquad: true });
        const route = `${apiPath`/api/squads/${ctx.squadId}`}/${path}/${encodeURIComponent(memberId)}${suffix ? `/${suffix}` : ""}`;
        printOutput(await ctx.api.patch(route, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSquad: false },
  );
}

function addMemberPost(parent: Command, name: string, path: string, suffix: string): void {
  addCommonClientOptions(
    parent.command(name).description(`${name} a member`).argument("<memberId>", "Member ID").option("-C, --squad-id <id>", "Squad ID").option("--payload-json <json>", "JSON payload", "{}").action(async (memberId: string, opts: JsonPayloadOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSquad: true });
        printOutput(await ctx.api.post(`${apiPath`/api/squads/${ctx.squadId}`}/${path}/${encodeURIComponent(memberId)}/${suffix}`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSquad: false },
  );
}

function addAdminUserPost(parent: Command, name: string, suffix: string): void {
  addCommonClientOptions(parent.command(name).description(`${name} instance admin`).argument("<userId>", "User ID").action(async (userId: string, opts: BaseClientOptions) => {
    try {
      const ctx = resolveCommandContext(opts);
      printOutput(await ctx.api.post(`${apiPath`/api/admin/users/${userId}`}/${suffix}`, {}), { json: ctx.json });
    } catch (err) {
      handleCommandError(err);
    }
  }));
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
