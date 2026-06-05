import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "@/lib/router";
import { useSquad } from "../context/SquadContext";
import { toSquadRelativePath } from "../lib/squad-routes";
import {
  getRememberedPathOwnerSquadId,
  isRememberableSquadPath,
  sanitizeRememberedPathForSquad,
} from "../lib/squad-page-memory";

const STORAGE_KEY = "slaw.squadPaths";

function getSquadPaths(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

function saveSquadPath(squadId: string, path: string) {
  const paths = getSquadPaths();
  paths[squadId] = path;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
}

/**
 * Remembers the last visited page per squad and navigates to it on squad switch.
 * Falls back to /dashboard if no page was previously visited for a squad.
 */
export function useSquadPageMemory() {
  const { squads, selectedSquadId, selectedSquad, selectionSource } = useSquad();
  const location = useLocation();
  const navigate = useNavigate();
  const prevSquadId = useRef<string | null>(selectedSquadId);
  const rememberedPathOwnerSquadId = useMemo(
    () =>
      getRememberedPathOwnerSquadId({
        squads,
        pathname: location.pathname,
        fallbackSquadId: prevSquadId.current,
      }),
    [squads, location.pathname],
  );

  // Save current path for current squad on every location change.
  // Uses prevSquadId ref so we save under the correct squad even
  // during the render where selectedSquadId has already changed.
  const fullPath = location.pathname + location.search;
  useEffect(() => {
    const squadId = rememberedPathOwnerSquadId;
    const relativePath = toSquadRelativePath(fullPath);
    if (squadId && isRememberableSquadPath(relativePath)) {
      saveSquadPath(squadId, relativePath);
    }
  }, [fullPath, rememberedPathOwnerSquadId]);

  // Navigate to saved path when squad changes
  useEffect(() => {
    if (!selectedSquadId) return;

    if (
      prevSquadId.current !== null &&
      selectedSquadId !== prevSquadId.current
    ) {
      if (selectionSource !== "route_sync" && selectedSquad) {
        const paths = getSquadPaths();
        const targetPath = sanitizeRememberedPathForSquad({
          path: paths[selectedSquadId],
          squadPrefix: selectedSquad.issuePrefix,
        });
        navigate(`/${selectedSquad.issuePrefix}${targetPath}`, { replace: true });
      }
    }
    prevSquadId.current = selectedSquadId;
  }, [selectedSquad, selectedSquadId, selectionSource, navigate]);
}
