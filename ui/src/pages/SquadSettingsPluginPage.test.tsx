// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SquadSettingsPluginPage } from "./SquadSettingsPluginPage";

const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockUsePluginSlots = vi.hoisted(() => vi.fn());
const mockParams = vi.hoisted(() => ({
  squadPrefix: "PAP" as string | undefined,
  settingsRoutePath: "permissions" as string | undefined,
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: mockSetBreadcrumbs,
  }),
}));

vi.mock("@/context/SquadContext", () => ({
  useSquad: () => ({
    squads: [{ id: "squad-1", name: "Slaw", issuePrefix: "PAP" }],
    selectedSquadId: "squad-1",
  }),
}));

vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  useLocation: () => ({ pathname: "/PAP/squad/settings/permissions", search: "", hash: "" }),
  useParams: () => mockParams,
}));

vi.mock("@/plugins/slots", () => ({
  usePluginSlots: mockUsePluginSlots,
  PluginSlotMount: ({
    slot,
    context,
  }: {
    slot: { displayName: string };
    context: { squadId: string | null; squadPrefix: string | null };
  }) => (
    <div data-testid="plugin-slot-mount">
      {slot.displayName}:{context.squadId}:{context.squadPrefix}
    </div>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function renderPage(container: HTMLDivElement) {
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <SquadSettingsPluginPage />
      </QueryClientProvider>,
    );
  });
  await flushReact();
  return root;
}

describe("SquadSettingsPluginPage", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockParams.squadPrefix = "PAP";
    mockParams.settingsRoutePath = "permissions";
    mockUsePluginSlots.mockReturnValue({
      slots: [
        {
          type: "squadSettingsPage",
          id: "permissions",
          displayName: "Permissions",
          exportName: "PermissionsPage",
          routePath: "permissions",
          pluginId: "plugin-1",
          pluginKey: "permissions-extension",
          pluginDisplayName: "Permissions Extension",
          pluginVersion: "0.1.0",
        },
      ],
      isLoading: false,
      errorMessage: null,
    });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("mounts the matching squad settings slot with squad context", async () => {
    const root = await renderPage(container);

    expect(container.querySelector('[data-testid="plugin-slot-mount"]')?.textContent).toBe(
      "Permissions:squad-1:PAP",
    );
    expect(mockSetBreadcrumbs).toHaveBeenCalledWith([
      { label: "Settings", href: "/squad/settings" },
      { label: "Permissions" },
    ]);

    await act(async () => {
      root.unmount();
    });
  });

  it("fails closed when no ready plugin declares the route", async () => {
    mockUsePluginSlots.mockReturnValue({
      slots: [],
      isLoading: false,
      errorMessage: null,
    });
    const root = await renderPage(container);

    expect(container.textContent).toContain("Page not found");

    await act(async () => {
      root.unmount();
    });
  });
});
