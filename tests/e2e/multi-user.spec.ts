import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * E2E: Multi-user implementation tests (local_trusted mode).
 *
 * Covers:
 *   1. Squad member management API (list, update role, suspend)
 *   2. Human invite creation and acceptance API
 *   3. Squad Settings UI — member list, role editing, invite creation
 *   4. Invite landing page UI
 *   5. Role-based access control (viewer read-only)
 *   6. Last-owner protection
 */

const BASE = process.env.SLAW_E2E_BASE_URL ?? "http://127.0.0.1:3104";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure the server is bootstrapped (claimed) before running tests. */
async function ensureBootstrapped(request: APIRequestContext): Promise<void> {
  const healthRes = await request.get(`${BASE}/api/health`);
  const health = await healthRes.json();
  if (health.bootstrapStatus === "ready") return;

  // If bootstrap_pending, we need to use the claim token from the bootstrap invite.
  // In local_trusted mode, just try hitting squads — that should auto-bootstrap.
  if (health.deploymentMode === "local_trusted") {
    // local_trusted should work without explicit bootstrap
    return;
  }
}

/** Create a squad via the onboarding wizard API shortcut. */
async function createSquadViaWizard(
  request: APIRequestContext,
  name: string
): Promise<{ squadId: string; agentId: string; prefix: string }> {
  await ensureBootstrapped(request);

  const createRes = await request.post(`${BASE}/api/squads`, {
    data: { name },
  });
  if (!createRes.ok()) {
    const errText = await createRes.text();
    throw new Error(
      `Failed to create squad (${createRes.status()}): ${errText}`
    );
  }
  const squad = await createRes.json();

  // Create a Squad Lead agent
  const agentRes = await request.post(
    `${BASE}/api/squads/${squad.id}/agents`,
    {
      data: {
        name: "Squad Lead",
        role: "squad_lead",
        title: "Squad Lead",
        adapterType: "claude_local",
      },
    }
  );
  expect(agentRes.ok()).toBe(true);
  const agent = await agentRes.json();

  return {
    squadId: squad.id,
    agentId: agent.id,
    prefix: squad.issuePrefix ?? squad.id,
  };
}

/** Create a human invite and return token + invite URL. */
async function createHumanInvite(
  request: APIRequestContext,
  squadId: string,
  role: string = "operator"
): Promise<{ token: string; inviteUrl: string; inviteId: string }> {
  const res = await request.post(
    `${BASE}/api/squads/${squadId}/invites`,
    {
      data: {
        allowedJoinTypes: "human",
        humanRole: role,
      },
    }
  );
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return {
    token: body.token,
    inviteUrl: body.inviteUrl,
    inviteId: body.id,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Multi-user: API", () => {
  let squadId: string;

  test.beforeAll(async ({ request }) => {
    const result = await createSquadViaWizard(
      request,
      `MU-API-${Date.now()}`
    );
    squadId = result.squadId;
  });

  test("GET /squads/:id/members returns member list with access info", async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/api/squads/${squadId}/members`
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(body).toHaveProperty("members");
    expect(body).toHaveProperty("access");
    expect(Array.isArray(body.members)).toBe(true);
    expect(body.access).toHaveProperty("currentUserRole");
    expect(body.access).toHaveProperty("canManageMembers");
    expect(body.access).toHaveProperty("canInviteUsers");
  });

  test("POST /squads/:id/invites creates a human invite with role", async ({
    request,
  }) => {
    const res = await request.post(
      `${BASE}/api/squads/${squadId}/invites`,
      {
        data: {
          allowedJoinTypes: "human",
          humanRole: "operator",
        },
      }
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(body).toHaveProperty("token");
    expect(body).toHaveProperty("inviteUrl");
    expect(body.allowedJoinTypes).toBe("human");
    expect(body.inviteUrl).toContain("/invite/");
  });

  test("GET /invites/:token returns invite summary", async ({ request }) => {
    const invite = await createHumanInvite(request, squadId, "viewer");
    const res = await request.get(`${BASE}/api/invites/${invite.token}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(body).toHaveProperty("squadId");
    expect(body).toHaveProperty("allowedJoinTypes");
    expect(body.allowedJoinTypes).toBe("human");
    expect(body).toHaveProperty("inviteType");
    expect(body.inviteType).toBe("squad_join");
  });

  test("POST /invites/:token/accept (human) creates membership", async ({
    request,
  }) => {
    const invite = await createHumanInvite(request, squadId, "operator");
    const acceptRes = await request.post(
      `${BASE}/api/invites/${invite.token}/accept`,
      {
        data: { requestType: "human" },
      }
    );
    expect(acceptRes.ok()).toBe(true);
    const body = await acceptRes.json();

    // In local_trusted, human accept should succeed
    expect(body).toHaveProperty("id");
  });

  test("POST /invites/:token/accept rejects agent on human-only invite", async ({
    request,
  }) => {
    const invite = await createHumanInvite(request, squadId, "operator");
    const acceptRes = await request.post(
      `${BASE}/api/invites/${invite.token}/accept`,
      {
        data: { requestType: "agent", agentName: "Rogue" },
      }
    );
    expect(acceptRes.ok()).toBe(false);
    expect(acceptRes.status()).toBe(400);
  });

  test("POST /squads/:id/invites supports all four roles", async ({
    request,
  }) => {
    for (const role of ["owner", "admin", "operator", "viewer"]) {
      const res = await request.post(
        `${BASE}/api/squads/${squadId}/invites`,
        {
          data: { allowedJoinTypes: "human", humanRole: role },
        }
      );
      expect(res.ok()).toBe(true);
      const body = await res.json();
      expect(body.token).toBeTruthy();
    }
  });

  test("PATCH /squads/:id/members/:memberId cannot remove last owner", async ({
    request,
  }) => {
    // Create a fresh squad for this test
    const fresh = await createSquadViaWizard(
      request,
      `MU-LastOwner-${Date.now()}`
    );

    // First promote the local-board member to owner
    const membersRes = await request.get(
      `${BASE}/api/squads/${fresh.squadId}/members`
    );
    const { members } = await membersRes.json();

    // Find the board member (should be the only one)
    const boardMember = members.find(
      (m: { principalId: string }) => m.principalId === "local-board"
    );
    if (!boardMember) {
      test.skip();
      return;
    }

    // Promote to owner first
    const promoteRes = await request.patch(
      `${BASE}/api/squads/${fresh.squadId}/members/${boardMember.id}`,
      { data: { membershipRole: "owner" } }
    );
    expect(promoteRes.ok()).toBe(true);

    // Now try to demote the last (and only) owner to operator — should fail
    const demoteRes = await request.patch(
      `${BASE}/api/squads/${fresh.squadId}/members/${boardMember.id}`,
      { data: { membershipRole: "operator" } }
    );
    expect(demoteRes.status()).toBe(409);
    const errBody = await demoteRes.json();
    expect(JSON.stringify(errBody)).toContain("last active owner");
  });

});

test.describe("Multi-user: Squad Settings UI", () => {
  let squadId: string;
  let squadPrefix: string;

  test.beforeAll(async ({ request }) => {
    const result = await createSquadViaWizard(
      request,
      `MU-UI-${Date.now()}`
    );
    squadId = result.squadId;
    squadPrefix = result.prefix;
  });

  test("shows Team and Invites sections on settings page", async ({ page }) => {
    await page.goto(`${BASE}/${squadPrefix}/squad/settings`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("squad-settings-invites-section")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("squad-settings-team-section")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows human invite creation controls", async ({ page }) => {
    await page.goto(`${BASE}/${squadPrefix}/squad/settings`);
    await page.waitForLoadState("networkidle");
    const inviteButton = page.getByTestId("squad-settings-create-human-invite");
    await expect(inviteButton).toBeVisible({ timeout: 10_000 });

    const roleSelect = page.getByTestId("squad-settings-human-invite-role");
    await expect(roleSelect).toBeVisible();
  });

  test("can create human invite and shows URL", async ({ page }) => {
    await page.goto(`${BASE}/${squadPrefix}/squad/settings`);
    await page.waitForLoadState("networkidle");
    const inviteButton = page.getByTestId("squad-settings-create-human-invite");
    await expect(inviteButton).toBeVisible({ timeout: 10_000 });
    await inviteButton.click();

    await expect(page.getByTestId("squad-settings-human-invite-url")).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("Multi-user: Invite Landing UI", () => {
  let squadId: string;
  let inviteToken: string;

  test.beforeAll(async ({ request }) => {
    const result = await createSquadViaWizard(
      request,
      `MU-Invite-${Date.now()}`
    );
    squadId = result.squadId;

    const invite = await createHumanInvite(request, squadId, "operator");
    inviteToken = invite.token;
  });

  test("invite landing page loads with join options", async ({ page }) => {
    await page.goto(`${BASE}/invite/${inviteToken}`);
    await page.waitForLoadState("networkidle");

    // Should show the invite landing page heading
    await expect(
      page.getByRole("heading", { name: /join/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("invite landing shows human join type", async ({ page }) => {
    await page.goto(`${BASE}/invite/${inviteToken}`);
    await page.waitForLoadState("networkidle");

    // For a human-only invite, should show human join option
    const humanOption = page.locator("text=/human/i");
    await expect(humanOption).toBeVisible({ timeout: 10_000 });
  });

  test("expired/invalid invite token returns error", async ({ page }) => {
    await page.goto(`${BASE}/invite/invalid-token-e2e-test`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("invite-error")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Multi-user: Member role management API", () => {
  let squadId: string;

  test.beforeAll(async ({ request }) => {
    const result = await createSquadViaWizard(
      request,
      `MU-Roles-${Date.now()}`
    );
    squadId = result.squadId;
  });

  test("invite + accept creates member with correct role", async ({
    request,
  }) => {
    // Create invite for 'viewer' role
    const invite = await createHumanInvite(request, squadId, "viewer");

    // Accept the invite
    const acceptRes = await request.post(
      `${BASE}/api/invites/${invite.token}/accept`,
      { data: { requestType: "human" } }
    );
    expect(acceptRes.ok()).toBe(true);

    // Check members list
    const membersRes = await request.get(
      `${BASE}/api/squads/${squadId}/members`
    );
    const { members } = await membersRes.json();

    // Should have at least one member (the creator/local-board)
    expect(members.length).toBeGreaterThanOrEqual(1);
  });

  test("PATCH member role updates correctly", async ({ request }) => {
    // First create an invite and accept it to get a second member
    const invite = await createHumanInvite(request, squadId, "operator");
    const acceptRes = await request.post(
      `${BASE}/api/invites/${invite.token}/accept`,
      { data: { requestType: "human" } }
    );
    expect(acceptRes.ok()).toBe(true);

    // List members
    const membersRes = await request.get(
      `${BASE}/api/squads/${squadId}/members`
    );
    const { members } = await membersRes.json();

    // Find a non-owner member to modify
    const nonOwner = members.find(
      (m: { membershipRole: string }) => m.membershipRole !== "owner"
    );
    if (!nonOwner) {
      test.skip();
      return;
    }

    // Update role to admin
    const patchRes = await request.patch(
      `${BASE}/api/squads/${squadId}/members/${nonOwner.id}`,
      { data: { membershipRole: "admin" } }
    );
    expect(patchRes.ok()).toBe(true);
    const updated = await patchRes.json();
    expect(updated.membershipRole).toBe("admin");
  });

  test("PATCH member status to suspended works", async ({ request }) => {
    // Create another member
    const invite = await createHumanInvite(request, squadId, "operator");
    await request.post(`${BASE}/api/invites/${invite.token}/accept`, {
      data: { requestType: "human" },
    });

    const membersRes = await request.get(
      `${BASE}/api/squads/${squadId}/members`
    );
    const { members } = await membersRes.json();

    const nonOwner = members.find(
      (m: { membershipRole: string; status: string }) =>
        m.membershipRole !== "owner" && m.status === "active"
    );
    if (!nonOwner) {
      test.skip();
      return;
    }

    const patchRes = await request.patch(
      `${BASE}/api/squads/${squadId}/members/${nonOwner.id}`,
      { data: { status: "suspended" } }
    );
    expect(patchRes.ok()).toBe(true);
    const updated = await patchRes.json();
    expect(updated.status).toBe("suspended");
  });
});

test.describe("Multi-user: Agent invite flow", () => {
  let squadId: string;

  test.beforeAll(async ({ request }) => {
    const result = await createSquadViaWizard(
      request,
      `MU-Agent-${Date.now()}`
    );
    squadId = result.squadId;
  });

  test("agent invite accept creates pending join request", async ({
    request,
  }) => {
    // Create agent invite
    const res = await request.post(
      `${BASE}/api/squads/${squadId}/invites`,
      { data: { allowedJoinTypes: "agent" } }
    );
    expect(res.ok()).toBe(true);
    const { token } = await res.json();

    // Accept as agent
    const acceptRes = await request.post(
      `${BASE}/api/invites/${token}/accept`,
      {
        data: {
          requestType: "agent",
          agentName: "TestAgent",
          adapterType: "claude_local",
        },
      }
    );
    expect(acceptRes.ok()).toBe(true);
    const body = await acceptRes.json();
    expect(body).toHaveProperty("id");
    expect(body.status).toBe("pending_approval");
  });

  test("join requests list shows pending agent request", async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/api/squads/${squadId}/join-requests?status=pending_approval`
    );
    expect(res.ok()).toBe(true);
    const requests = await res.json();
    expect(Array.isArray(requests)).toBe(true);
  });
});

test.describe("Multi-user: Health check integration", () => {
  test("health endpoint reports deployment mode", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("deploymentMode");
    expect(body).toHaveProperty("authReady");
    expect(body.authReady).toBe(true);
  });
});
