// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Squad } from "@slaw-ai/shared";
import { queryKeys } from "../lib/queryKeys";
import {
  SquadProvider,
  resolveBootstrapSquadSelection,
  shouldClearStoredSquadSelection,
  useSquad,
} from "./SquadContext";

const mockSquadsApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}));

vi.mock("../api/squads", () => ({
  squadsApi: mockSquadsApi,
}));

const activeSquad = { id: "squad-1" };
const secondActiveSquad = { id: "squad-2" };
const archivedSquad = { id: "archived-squad" };

function makeSquad(id: string): Squad {
  return {
    id,
    name: "Slaw",
    description: null,
    status: "active",
    pauseReason: null,
    pausedAt: null,
    issuePrefix: "PAP",
    issueCounter: 1,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    attachmentMaxBytes: 10 * 1024 * 1024,
    requireOperatorApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    brandColor: null,
    logoAssetId: null,
    logoUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function Probe({ onSelectedSquadId }: { onSelectedSquadId: (squadId: string | null) => void }) {
  const { selectedSquadId } = useSquad();
  useEffect(() => {
    onSelectedSquadId(selectedSquadId);
  }, [onSelectedSquadId, selectedSquadId]);
  return <div data-selected-squad-id={selectedSquadId ?? ""} />;
}

describe("resolveBootstrapSquadSelection", () => {
  it("does not expose a stale stored squad id before squads load", () => {
    expect(resolveBootstrapSquadSelection({
      squads: [],
      sidebarSquads: [],
      selectedSquadId: null,
      storedSquadId: "stale-squad",
    })).toBeNull();
  });

  it("replaces a stale stored squad id with the first loaded squad", () => {
    expect(resolveBootstrapSquadSelection({
      squads: [activeSquad],
      sidebarSquads: [activeSquad],
      selectedSquadId: null,
      storedSquadId: "stale-squad",
    })).toBe("squad-1");
  });

  it("keeps a valid selected squad ahead of stored bootstrap state", () => {
    expect(resolveBootstrapSquadSelection({
      squads: [activeSquad],
      sidebarSquads: [activeSquad],
      selectedSquadId: "squad-1",
      storedSquadId: "stale-squad",
    })).toBe("squad-1");
  });

  it("keeps a valid stored squad id instead of falling back to the first squad", () => {
    expect(resolveBootstrapSquadSelection({
      squads: [activeSquad, secondActiveSquad],
      sidebarSquads: [activeSquad, secondActiveSquad],
      selectedSquadId: null,
      storedSquadId: "squad-2",
    })).toBe("squad-2");
  });

  it("uses selectable sidebar squads before archived squads", () => {
    expect(resolveBootstrapSquadSelection({
      squads: [archivedSquad, activeSquad],
      sidebarSquads: [activeSquad],
      selectedSquadId: null,
      storedSquadId: "archived-squad",
    })).toBe("squad-1");
  });
});

describe("shouldClearStoredSquadSelection", () => {
  it("does not clear the stored squad selection during an unauthorized squad list response", () => {
    expect(shouldClearStoredSquadSelection({
      squads: [],
      isLoading: false,
      unauthorized: true,
    })).toBe(false);
  });

  it("clears the stored squad selection when an authorized squad list is empty", () => {
    expect(shouldClearStoredSquadSelection({
      squads: [],
      isLoading: false,
      unauthorized: false,
    })).toBe(true);
  });
});

describe("SquadProvider", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
  });

  it("does not expose a stale stored squad id before squads load", async () => {
    localStorage.setItem("slaw.selectedSquadId", "stale-squad");
    mockSquadsApi.list.mockImplementation(() => new Promise(() => {}));
    const seen: Array<string | null> = [];

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SquadProvider>
            <Probe onSelectedSquadId={(squadId) => seen.push(squadId)} />
          </SquadProvider>
        </QueryClientProvider>,
      );
    });

    expect(seen).toEqual([null]);
  });

  it("replaces a stale stored squad id with the first loaded squad", async () => {
    localStorage.setItem("slaw.selectedSquadId", "stale-squad");
    queryClient.setQueryData(queryKeys.squads.all, {
      squads: [makeSquad("squad-1")],
      unauthorized: false,
    });
    mockSquadsApi.list.mockImplementation(() => new Promise(() => {}));
    const seen: Array<string | null> = [];

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SquadProvider>
            <Probe onSelectedSquadId={(squadId) => seen.push(squadId)} />
          </SquadProvider>
        </QueryClientProvider>,
      );
    });

    expect(seen).toEqual([null, "squad-1"]);
    expect(localStorage.getItem("slaw.selectedSquadId")).toBe("squad-1");
  });
});
