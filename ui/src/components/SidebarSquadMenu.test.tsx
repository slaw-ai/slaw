// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarSquadMenu } from "./SidebarSquadMenu";

const mockAuthApi = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  signOut: vi.fn(),
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockOpenOnboarding = vi.hoisted(() => vi.fn());
const mockSetSelectedSquadId = vi.hoisted(() => vi.fn());
const mockSetSidebarOpen = vi.hoisted(() => vi.fn());
const mockLocation = vi.hoisted(() => ({ pathname: "/PAP/dashboard" }));
const mockSidebarPreferencesApi = vi.hoisted(() => ({
  getSquadOrder: vi.fn(),
  updateSquadOrder: vi.fn(),
}));

vi.mock("@/api/auth", () => ({
  authApi: mockAuthApi,
}));

vi.mock("@/api/sidebarPreferences", () => ({
  sidebarPreferencesApi: mockSidebarPreferencesApi,
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

vi.mock("@/context/SquadContext", () => ({
  useSquad: () => ({
    squads: [
      {
        id: "squad-1",
        issuePrefix: "PAP",
        name: "Acme Labs",
        brandColor: "#3366ff",
        status: "active",
      },
      {
        id: "squad-2",
        issuePrefix: "STR",
        name: "Strata",
        brandColor: "#36a269",
        status: "active",
      },
      {
        id: "squad-3",
        issuePrefix: "ANA",
        name: "Anachronist Wiki",
        brandColor: "#a36a21",
        status: "active",
      },
    ],
    selectedSquad: {
      id: "squad-1",
      issuePrefix: "PAP",
      name: "Acme Labs",
      brandColor: "#3366ff",
      status: "active",
    },
    setSelectedSquadId: mockSetSelectedSquadId,
  }),
}));

vi.mock("@/context/DialogContext", () => ({
  useDialogActions: () => ({
    openOnboarding: mockOpenOnboarding,
  }),
}));

vi.mock("./SquadPatternIcon", () => ({
  SquadPatternIcon: ({ squadName }: { squadName: string }) => (
    <span aria-hidden="true">{squadName.slice(0, 1)}</span>
  ),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({
    isMobile: false,
    setSidebarOpen: mockSetSidebarOpen,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("SidebarSquadMenu", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-1", userId: "user-1" },
      user: {
        id: "user-1",
        name: "Jane Example",
        email: "jane@example.com",
      },
    });
    mockAuthApi.signOut.mockResolvedValue(undefined);
    mockSidebarPreferencesApi.getSquadOrder.mockResolvedValue({
      orderedIds: ["squad-1", "squad-2", "squad-3"],
      updatedAt: null,
    });
    mockSidebarPreferencesApi.updateSquadOrder.mockResolvedValue({
      orderedIds: ["squad-1", "squad-2", "squad-3"],
      updatedAt: null,
    });
    mockLocation.pathname = "/PAP/dashboard";
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows the requested squad actions and signs out through the dropdown", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SidebarSquadMenu />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Acme Labs");

    const trigger = container.querySelector('button[aria-label="Open Acme Labs workspace switcher"]');
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(document.body.textContent).toContain("Switch workspace");
    expect(document.body.textContent).toContain("Edit");
    expect(document.body.textContent).toContain("Strata");
    expect(document.body.textContent).toContain("ANA");
    expect(document.body.textContent).toContain("Add squad...");
    expect(document.body.textContent).toContain("Invite people to Acme Labs");
    expect(document.body.textContent).toContain("Squad settings");
    expect(document.body.textContent).toContain("Sign out");

    const signOutButton = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]'))
      .find((element) => element.textContent?.includes("Sign out"));
    expect(signOutButton).toBeTruthy();

    await act(async () => {
      signOutButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(mockAuthApi.signOut).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("toggles squad order editing without selecting a workspace", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SidebarSquadMenu />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const trigger = container.querySelector('button[aria-label="Open Acme Labs workspace switcher"]');
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const editButton = Array.from(document.body.querySelectorAll("button"))
      .find((element) => element.textContent === "Edit");
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(document.body.textContent).toContain("Done");
    expect(document.body.textContent).not.toContain("PAP");
    expect(document.body.textContent).not.toContain("ANA");
    expect(document.body.querySelector('button[aria-label="Reorder Strata"]')).toBeTruthy();

    const strataItem = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]'))
      .find((element) => element.textContent?.includes("Strata"));
    expect(strataItem).toBeTruthy();

    await act(async () => {
      strataItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(mockSetSelectedSquadId).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("navigates to the selected workspace dashboard from squad-prefixed routes", async () => {
    mockLocation.pathname = "/PAP/issues";
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SidebarSquadMenu />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const trigger = container.querySelector('button[aria-label="Open Acme Labs workspace switcher"]');
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const strataItem = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]'))
      .find((element) => element.textContent?.includes("Strata"));
    expect(strataItem).toBeTruthy();

    await act(async () => {
      strataItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(mockSetSelectedSquadId).toHaveBeenCalledWith("squad-2");
    expect(mockNavigate).toHaveBeenCalledWith("/STR/dashboard");

    await act(async () => {
      root.unmount();
    });
  });
});
