// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SquadSettingsNav, getSquadSettingsTab } from "./SquadSettingsNav";

let currentPathname = "/squad/settings";
const navigateMock = vi.hoisted(() => vi.fn());
const pageTabBarMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: currentPathname, search: "", hash: "" }),
  useNavigate: () => navigateMock,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div data-testid="tabs-root">{children}</div>,
}));

vi.mock("@/components/PageTabBar", () => ({
  PageTabBar: (props: {
    items: Array<{ value: string; label: string }>;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => {
    pageTabBarMock(props);

    return (
      <div>
        <div data-testid="active-tab">{props.value}</div>
        <button type="button" onClick={() => props.onValueChange?.("invites")}>
          switch-tab
        </button>
      </div>
    );
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

describe("SquadSettingsNav", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    currentPathname = "/squad/settings";
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("maps squad settings routes to the expected shared tab value", () => {
    expect(getSquadSettingsTab("/squad/settings")).toBe("general");
    expect(getSquadSettingsTab("/PAP/squad/settings")).toBe("general");
    expect(getSquadSettingsTab("/squad/settings/environments")).toBe("environments");
    expect(getSquadSettingsTab("/PAP/squad/settings/environments")).toBe("environments");
    expect(getSquadSettingsTab("/squad/settings/cloud-upstream")).toBe("cloud-upstream");
    expect(getSquadSettingsTab("/squad/settings/members")).toBe("members");
    expect(getSquadSettingsTab("/PAP/squad/settings/members")).toBe("members");
    expect(getSquadSettingsTab("/squad/settings/access")).toBe("members");
    expect(getSquadSettingsTab("/PAP/squad/settings/access")).toBe("members");
    expect(getSquadSettingsTab("/squad/settings/invites")).toBe("invites");
    expect(getSquadSettingsTab("/PAP/squad/settings/secrets")).toBe("secrets");
  });

  it("renders the active tab and navigates when a different tab is selected", async () => {
    currentPathname = "/PAP/squad/settings/members";
    const root = createRoot(container);

    await act(async () => {
      root.render(<SquadSettingsNav />);
    });

    expect(container.textContent).toContain("members");
    expect(pageTabBarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "members",
        items: [
          { value: "general", label: "General" },
          { value: "environments", label: "Environments" },
          { value: "cloud-upstream", label: "Cloud upstream" },
          { value: "members", label: "Members" },
          { value: "invites", label: "Invites" },
          { value: "secrets", label: "Secrets" },
        ],
      }),
    );

    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(navigateMock).toHaveBeenCalledWith("/squad/settings/invites");

    await act(async () => {
      root.unmount();
    });
  });
});
