import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Squad } from "@slaw-ai/shared";
import { squadsApi } from "../api/squads";
import { squadsListQueryOptions, type SquadListResult } from "../api/squads-query";
import { queryKeys } from "../lib/queryKeys";
import type { SquadSelectionSource } from "../lib/squad-selection";
type SquadSelectionOptions = { source?: SquadSelectionSource };

interface SquadContextValue {
  squads: Squad[];
  selectedSquadId: string | null;
  selectedSquad: Squad | null;
  selectionSource: SquadSelectionSource;
  loading: boolean;
  error: Error | null;
  setSelectedSquadId: (squadId: string, options?: SquadSelectionOptions) => void;
  reloadSquads: () => Promise<void>;
  createSquad: (data: {
    name: string;
    description?: string | null;
    budgetMonthlyCents?: number;
  }) => Promise<Squad>;
}

const STORAGE_KEY = "slaw.selectedSquadId";

const SquadContext = createContext<SquadContextValue | null>(null);

export function resolveBootstrapSquadSelection(input: {
  squads: Array<Pick<Squad, "id">>;
  sidebarSquads: Array<Pick<Squad, "id">>;
  selectedSquadId: string | null;
  storedSquadId: string | null;
}) {
  if (input.squads.length === 0) return null;

  const selectableSquads = input.sidebarSquads.length > 0
    ? input.sidebarSquads
    : input.squads;
  if (input.selectedSquadId && selectableSquads.some((squad) => squad.id === input.selectedSquadId)) {
    return input.selectedSquadId;
  }
  if (input.storedSquadId && selectableSquads.some((squad) => squad.id === input.storedSquadId)) {
    return input.storedSquadId;
  }
  return selectableSquads[0]?.id ?? null;
}

export function shouldClearStoredSquadSelection(input: {
  squads: Array<Pick<Squad, "id">>;
  isLoading: boolean;
  unauthorized: boolean;
}) {
  return !input.isLoading && !input.unauthorized && input.squads.length === 0;
}

export function SquadProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [selectionSource, setSelectionSource] = useState<SquadSelectionSource>("bootstrap");
  const [selectedSquadId, setSelectedSquadIdState] = useState<string | null>(null);

  const { data: squadsResult = { squads: [], unauthorized: false }, isLoading, error } =
    useQuery<SquadListResult>(squadsListQueryOptions);
  const squads = squadsResult.squads;
  const squadListUnauthorized = squadsResult.unauthorized;
  const sidebarSquads = useMemo(
    () => squads.filter((squad) => squad.status !== "archived"),
    [squads],
  );

  // Auto-select first squad when list loads
  useEffect(() => {
    if (isLoading) return;
    if (squads.length === 0) {
      if (shouldClearStoredSquadSelection({ squads, isLoading: false, unauthorized: squadListUnauthorized })) {
        if (selectedSquadId !== null) {
          setSelectedSquadIdState(null);
        }
        localStorage.removeItem(STORAGE_KEY);
      }
      return;
    }

    const next = resolveBootstrapSquadSelection({
      squads,
      sidebarSquads,
      selectedSquadId,
      storedSquadId: localStorage.getItem(STORAGE_KEY),
    });
    if (next === null || next === selectedSquadId) return;
    setSelectedSquadIdState(next);
    setSelectionSource("bootstrap");
    localStorage.setItem(STORAGE_KEY, next);
  }, [squads, squadListUnauthorized, isLoading, selectedSquadId, sidebarSquads]);

  const setSelectedSquadId = useCallback((squadId: string, options?: SquadSelectionOptions) => {
    setSelectedSquadIdState(squadId);
    setSelectionSource(options?.source ?? "manual");
    localStorage.setItem(STORAGE_KEY, squadId);
  }, []);

  const reloadSquads = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.squads.all });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) =>
      squadsApi.create(data),
    onSuccess: (squad) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.squads.all });
      setSelectedSquadId(squad.id);
    },
  });

  const createSquad = useCallback(
    async (data: {
      name: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) => {
      return createMutation.mutateAsync(data);
    },
    [createMutation],
  );

  const selectedSquad = useMemo(
    () => squads.find((squad) => squad.id === selectedSquadId) ?? null,
    [squads, selectedSquadId],
  );

  const value = useMemo(
    () => ({
      squads,
      selectedSquadId,
      selectedSquad,
      selectionSource,
      loading: isLoading,
      error: error as Error | null,
      setSelectedSquadId,
      reloadSquads,
      createSquad,
    }),
    [
      squads,
      selectedSquadId,
      selectedSquad,
      selectionSource,
      isLoading,
      error,
      setSelectedSquadId,
      reloadSquads,
      createSquad,
    ],
  );

  return <SquadContext.Provider value={value}>{children}</SquadContext.Provider>;
}

export function useSquad() {
  const ctx = useContext(SquadContext);
  if (!ctx) {
    throw new Error("useSquad must be used within SquadProvider");
  }
  return ctx;
}
