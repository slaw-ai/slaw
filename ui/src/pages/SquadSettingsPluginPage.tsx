import { useEffect, useMemo } from "react";
import { useParams } from "@/lib/router";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useSquad } from "@/context/SquadContext";
import { PluginSlotMount, usePluginSlots } from "@/plugins/slots";
import { NotFoundPage } from "./NotFound";

export function SquadSettingsPluginPage() {
  const params = useParams<{
    squadPrefix?: string;
    settingsRoutePath?: string;
  }>();
  const { squadPrefix: routeSquadPrefix, settingsRoutePath } = params;
  const { squads, selectedSquadId } = useSquad();
  const { setBreadcrumbs } = useBreadcrumbs();

  const routeSquad = useMemo(() => {
    if (!routeSquadPrefix) return null;
    const requested = routeSquadPrefix.toUpperCase();
    return squads.find((squad) => squad.issuePrefix.toUpperCase() === requested) ?? null;
  }, [squads, routeSquadPrefix]);
  const hasInvalidSquadPrefix = Boolean(routeSquadPrefix) && !routeSquad;
  const resolvedSquadId = routeSquad?.id ?? (routeSquadPrefix ? null : selectedSquadId ?? null);
  const squadPrefix = resolvedSquadId
    ? squads.find((squad) => squad.id === resolvedSquadId)?.issuePrefix ?? null
    : null;

  const { slots, isLoading, errorMessage } = usePluginSlots({
    slotTypes: ["squadSettingsPage"],
    squadId: resolvedSquadId,
    enabled: Boolean(resolvedSquadId && settingsRoutePath),
  });

  const pageSlots = useMemo(() => {
    if (!settingsRoutePath) return [];
    return slots.filter((slot) => slot.routePath === settingsRoutePath);
  }, [settingsRoutePath, slots]);

  const pageSlot = pageSlots.length === 1 ? pageSlots[0] : null;

  useEffect(() => {
    if (!pageSlot) return;
    setBreadcrumbs([
      { label: "Settings", href: "/squad/settings" },
      { label: pageSlot.displayName },
    ]);
  }, [pageSlot, setBreadcrumbs]);

  if (!resolvedSquadId) {
    if (hasInvalidSquadPrefix) {
      return <NotFoundPage scope="invalid_squad_prefix" requestedPrefix={routeSquadPrefix} />;
    }
    return <div className="text-sm text-muted-foreground">Select a squad to view this page.</div>;
  }

  if (!settingsRoutePath || isLoading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  if (errorMessage) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Plugin extensions unavailable: {errorMessage}
      </div>
    );
  }

  if (pageSlots.length > 1) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Multiple plugins declare the squad settings route <code>{settingsRoutePath}</code>. Disable one plugin or change its route.
      </div>
    );
  }

  if (!pageSlot) {
    return <NotFoundPage scope="board" />;
  }

  return (
    <PluginSlotMount
      slot={pageSlot}
      context={{ squadId: resolvedSquadId, squadPrefix }}
      className="min-h-[200px]"
      missingBehavior="placeholder"
    />
  );
}
