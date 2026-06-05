import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  authUsers,
  squads,
  squadMemberships,
  createDb,
  instanceUserRoles,
  principalPermissionGrants,
} from "@slaw/db";
import {
  claimBoardOwnership,
  getBoardClaimWarningUrl,
  initializeBoardClaimChallenge,
  inspectBoardClaimChallenge,
} from "../board-claim.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("board claim", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("slaw-board-claim-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await initializeBoardClaimChallenge(db, { deploymentMode: "local_trusted" });
    await db.delete(principalPermissionGrants);
    await db.delete(squadMemberships);
    await db.delete(squads);
    await db.delete(instanceUserRoles);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("lets a signed-in user claim a local-board-only authenticated instance", async () => {
    const now = new Date();
    const userId = `claim-user-${randomUUID()}`;
    const squad = await db
      .insert(squads)
      .values({
        name: "Board Claim Co",
        issuePrefix: `BC${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning()
      .then((rows) => rows[0]!);

    await db.insert(authUsers).values({
      id: userId,
      name: "Board Claim User",
      email: "board-claim@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(instanceUserRoles).values({
      userId: "local-board",
      role: "instance_admin",
    });

    await initializeBoardClaimChallenge(db, { deploymentMode: "authenticated" });
    const warningUrl = getBoardClaimWarningUrl("127.0.0.1", 3197);
    expect(warningUrl).toBeTruthy();

    const parsed = new URL(warningUrl!);
    const token = parsed.pathname.split("/").pop()!;
    const code = parsed.searchParams.get("code")!;

    expect(inspectBoardClaimChallenge(token, code)).toMatchObject({
      status: "available",
      requiresSignIn: true,
      claimedByUserId: null,
    });

    await expect(
      claimBoardOwnership(db, { token, code, userId }),
    ).resolves.toEqual({
      status: "claimed",
      claimedByUserId: userId,
    });

    await expect(
      db
        .select()
        .from(instanceUserRoles)
        .where(and(eq(instanceUserRoles.userId, "local-board"), eq(instanceUserRoles.role, "instance_admin"))),
    ).resolves.toHaveLength(0);
    await expect(
      db
        .select()
        .from(instanceUserRoles)
        .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin"))),
    ).resolves.toHaveLength(1);
    await expect(
      db
        .select()
        .from(squadMemberships)
        .where(
          and(
            eq(squadMemberships.squadId, squad.id),
            eq(squadMemberships.principalType, "user"),
            eq(squadMemberships.principalId, userId),
          ),
        ),
    ).resolves.toMatchObject([
      {
        status: "active",
        membershipRole: "owner",
      },
    ]);
    expect(inspectBoardClaimChallenge(token, code)).toMatchObject({
      status: "claimed",
      claimedByUserId: userId,
    });
  });
});
