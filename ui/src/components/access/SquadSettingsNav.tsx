import { PageTabBar } from "@/components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { useLocation, useNavigate } from "@/lib/router";

const items = [
  { value: "general", label: "General", href: "/squad/settings" },
  { value: "environments", label: "Environments", href: "/squad/settings/environments" },
  { value: "cloud-upstream", label: "Cloud upstream", href: "/squad/settings/cloud-upstream" },
  { value: "members", label: "Members", href: "/squad/settings/members" },
  { value: "invites", label: "Invites", href: "/squad/settings/invites" },
  { value: "secrets", label: "Secrets", href: "/squad/settings/secrets" },
] as const;

type SquadSettingsTab = (typeof items)[number]["value"];

export function getSquadSettingsTab(pathname: string): SquadSettingsTab {
  if (pathname.includes("/squad/settings/environments")) {
    return "environments";
  }

  if (pathname.includes("/squad/settings/cloud-upstream")) {
    return "cloud-upstream";
  }

  if (pathname.includes("/squad/settings/members") || pathname.includes("/squad/settings/access")) {
    return "members";
  }

  if (pathname.includes("/squad/settings/invites")) {
    return "invites";
  }

  if (pathname.includes("/squad/settings/secrets")) {
    return "secrets";
  }

  return "general";
}

export function SquadSettingsNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = getSquadSettingsTab(location.pathname);

  function handleTabChange(value: string) {
    const nextTab = items.find((item) => item.value === value);
    if (!nextTab || nextTab.value === activeTab) return;
    navigate(nextTab.href);
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <PageTabBar
        items={items.map(({ value, label }) => ({ value, label }))}
        value={activeTab}
        onValueChange={handleTabChange}
        align="start"
      />
    </Tabs>
  );
}
