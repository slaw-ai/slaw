import { useEffect, useMemo } from "react";
import { Link, Navigate, useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useSquad } from "@/context/SquadContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import {
  PluginSlotMount,
  resolveRouteSidebarSlot,
  type ResolvedPluginSlot,
} from "@/plugins/slots";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { NotFoundPage } from "./NotFound";

/**
 * Squad-context plugin page. Renders a plugin's `page` slot at
 * `/:squadPrefix/plugins/:pluginId` when the plugin declares a page slot
 * and is enabled for that squad.
 *
 * @see doc/plugins/PLUGIN_SPEC.md §19.2 — Squad-Context Routes
 * @see doc/plugins/PLUGIN_SPEC.md §24.4 — Squad-Context Plugin Page
 */
export function PluginPage() {
  const params = useParams<{
    squadPrefix?: string;
    pluginId?: string;
    pluginRoutePath?: string;
    "*": string | undefined;
  }>();
  const { squadPrefix: routeSquadPrefix, pluginId, pluginRoutePath } = params;
  const pluginRouteSplat = params["*"];
  const { squads, selectedSquadId } = useSquad();
  const { setBreadcrumbs } = useBreadcrumbs();
  const routeSquad = useMemo(() => {
    if (!routeSquadPrefix) return null;
    const requested = routeSquadPrefix.toUpperCase();
    return squads.find((c) => c.issuePrefix.toUpperCase() === requested) ?? null;
  }, [squads, routeSquadPrefix]);
  const hasInvalidSquadPrefix = Boolean(routeSquadPrefix) && !routeSquad;

  const resolvedSquadId = useMemo(() => {
    if (routeSquad) return routeSquad.id;
    if (routeSquadPrefix) return null;
    return selectedSquadId ?? null;
  }, [routeSquad, routeSquadPrefix, selectedSquadId]);

  const squadPrefix = useMemo(
    () => (resolvedSquadId ? squads.find((c) => c.id === resolvedSquadId)?.issuePrefix ?? null : null),
    [squads, resolvedSquadId],
  );

  const { data: contributions } = useQuery({
    queryKey: queryKeys.plugins.uiContributions,
    queryFn: () => pluginsApi.listUiContributions(),
    enabled: !!resolvedSquadId && (!!pluginId || !!pluginRoutePath),
  });

  const pageSlot = useMemo(() => {
    if (!contributions) return null;
    if (pluginId) {
      const contribution = contributions.find((c) => c.pluginId === pluginId);
      if (!contribution) return null;
      const slot = contribution.slots.find((s) => s.type === "page");
      if (!slot) return null;
      return {
        ...slot,
        pluginId: contribution.pluginId,
        pluginKey: contribution.pluginKey,
        pluginDisplayName: contribution.displayName,
        pluginVersion: contribution.version,
      };
    }
    if (!pluginRoutePath) return null;
    const matches = contributions.flatMap((contribution) => {
      const slot = contribution.slots.find((entry) => entry.type === "page" && entry.routePath === pluginRoutePath);
      if (!slot) return [];
      return [{
        ...slot,
        pluginId: contribution.pluginId,
        pluginKey: contribution.pluginKey,
        pluginDisplayName: contribution.displayName,
        pluginVersion: contribution.version,
      }];
    });
    if (matches.length !== 1) return null;
    return matches[0] ?? null;
  }, [pluginId, pluginRoutePath, contributions]);

  const context = useMemo(
    () => ({
      squadId: resolvedSquadId ?? null,
      squadPrefix,
    }),
    [resolvedSquadId, squadPrefix],
  );

  // When the active route has a routeSidebar slot, the sidebar provides the
  // back affordance, but the top bar still needs a route-specific title.
  const routeSidebarActive = useMemo(() => {
    if (!pluginRoutePath || !contributions) return false;
    const flattened: ResolvedPluginSlot[] = contributions.flatMap((contribution) =>
      contribution.slots.map((slot) => ({
        ...slot,
        pluginId: contribution.pluginId,
        pluginKey: contribution.pluginKey,
        pluginDisplayName: contribution.displayName,
        pluginVersion: contribution.version,
      })),
    );
    return resolveRouteSidebarSlot(flattened, pluginRoutePath) !== null;
  }, [contributions, pluginRoutePath]);

  useEffect(() => {
    if (!pageSlot) return;
    if (routeSidebarActive) {
      setBreadcrumbs([{ label: resolveRouteSidebarPageTitle(pageSlot, pluginRouteSplat) }]);
      return;
    }
    setBreadcrumbs([
      { label: "Plugins", href: "/instance/settings/plugins" },
      { label: pageSlot.pluginDisplayName },
    ]);
  }, [pageSlot, pluginRouteSplat, setBreadcrumbs, routeSidebarActive]);

  if (!resolvedSquadId) {
    if (hasInvalidSquadPrefix) {
      return <NotFoundPage scope="invalid_squad_prefix" requestedPrefix={routeSquadPrefix} />;
    }
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Select a squad to view this page.</p>
      </div>
    );
  }

  if (!contributions) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  if (!pluginId && pluginRoutePath) {
    const duplicateMatches = contributions.filter((contribution) =>
      contribution.slots.some((slot) => slot.type === "page" && slot.routePath === pluginRoutePath),
    );
    if (duplicateMatches.length > 1) {
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Multiple plugins declare the route <code>{pluginRoutePath}</code>. Use the plugin-id route until the conflict is resolved.
        </div>
      );
    }
  }

  if (!pageSlot) {
    if (pluginRoutePath) {
      return <NotFoundPage scope="operator" />;
    }
    // No page slot: redirect to plugin settings where plugin info is always shown
    const settingsPath = pluginId ? `/instance/settings/plugins/${pluginId}` : "/instance/settings/plugins";
    return <Navigate to={settingsPath} replace />;
  }

  return (
    <div className="space-y-4">
      {!routeSidebarActive && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={squadPrefix ? `/${squadPrefix}/dashboard` : "/dashboard"}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
        </div>
      )}
      <PluginSlotMount
        slot={pageSlot}
        context={context}
        className="min-h-[200px]"
        missingBehavior="placeholder"
      />
    </div>
  );
}

function resolveRouteSidebarPageTitle(pageSlot: ResolvedPluginSlot, routeSplat: string | undefined): string {
  const title = titleFromRouteSplat(routeSplat);
  return title ?? pageSlot.displayName ?? pageSlot.pluginDisplayName;
}

function titleFromRouteSplat(routeSplat: string | undefined): string | null {
  const segments = (routeSplat ?? "")
    .split("/")
    .filter(Boolean)
    .map(decodeRouteSegment);
  if (segments.length === 0) return null;

  if (segments[0] === "page" && segments.length > 1) {
    return titleFromPath(segments.slice(1).join("/"), { preserveCase: true });
  }

  return titleFromPath(segments[0] ?? null);
}

function titleFromPath(path: string | null | undefined, options: { preserveCase?: boolean } = {}): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  const basename = trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
  const withoutNamespace = basename.split("::").at(-1) ?? basename;
  const withoutExtension = withoutNamespace.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension.replace(/[-_]+/g, " ").trim();
  if (!normalized) return null;
  if (options.preserveCase) return normalized;
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
