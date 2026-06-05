export type SquadSelectionSource = "manual" | "route_sync" | "bootstrap";

export function shouldSyncSquadSelectionFromRoute(params: {
  selectionSource: SquadSelectionSource;
  selectedSquadId: string | null;
  routeSquadId: string;
}): boolean {
  const { selectionSource, selectedSquadId, routeSquadId } = params;

  if (selectedSquadId === routeSquadId) return false;

  // Let manual squad switches finish their remembered-path navigation first.
  if (selectionSource === "manual" && selectedSquadId) {
    return false;
  }

  return true;
}
