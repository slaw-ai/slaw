import { describe, expect, it, vi } from "vitest";
import { issueTreeControlService } from "../services/issue-tree-control.js";

function emptySelectDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(resolve([])),
        })),
      })),
    })),
  };
}

describe("issueTreeControlService unit guards", () => {
  it("rejects cross-squad roots before traversing descendants", async () => {
    const db = emptySelectDb();
    const svc = issueTreeControlService(db as any);

    await expect(svc.preview("squad-2", "issue-from-squad-1", { mode: "pause" })).rejects.toMatchObject({
      status: 404,
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
