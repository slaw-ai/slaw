import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Squad } from "@slaw-ai/shared";
import { sidebarPreferencesApi } from "../api/sidebarPreferences";
import { queryKeys } from "../lib/queryKeys";

function areEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sortSquadsByOrder(squads: Squad[], orderedIds: string[]): Squad[] {
  if (squads.length === 0) return [];
  if (orderedIds.length === 0) return squads;

  const byId = new Map(squads.map((squad) => [squad.id, squad]));
  const sorted: Squad[] = [];

  for (const id of orderedIds) {
    const squad = byId.get(id);
    if (!squad) continue;
    sorted.push(squad);
    byId.delete(id);
  }
  for (const squad of byId.values()) {
    sorted.push(squad);
  }
  return sorted;
}

function buildOrderIds(squads: Squad[], orderedIds: string[]) {
  return sortSquadsByOrder(squads, orderedIds).map((squad) => squad.id);
}

type UseSquadOrderParams = {
  squads: Squad[];
  userId: string | null | undefined;
};

export function useSquadOrder({ squads, userId }: UseSquadOrderParams) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => queryKeys.sidebarPreferences.squadOrder(userId ?? "__anon__"),
    [userId],
  );

  const { data } = useQuery({
    queryKey,
    queryFn: () => sidebarPreferencesApi.getSquadOrder(),
    enabled: Boolean(userId),
  });

  const [orderedIds, setOrderedIds] = useState<string[]>(() => buildOrderIds(squads, []));

  useEffect(() => {
    const nextIds = buildOrderIds(squads, data?.orderedIds ?? []);
    setOrderedIds((current) => (areEqual(current, nextIds) ? current : nextIds));
  }, [squads, data?.orderedIds]);

  const mutation = useMutation({
    mutationFn: (nextIds: string[]) => sidebarPreferencesApi.updateSquadOrder({ orderedIds: nextIds }),
    onSuccess: (preference) => {
      queryClient.setQueryData(queryKey, preference);
    },
  });

  const orderedSquads = useMemo(
    () => sortSquadsByOrder(squads, orderedIds),
    [squads, orderedIds],
  );

  const persistOrder = useCallback(
    (ids: string[]) => {
      const idSet = new Set(squads.map((squad) => squad.id));
      const filtered = ids.filter((id) => idSet.has(id));
      for (const squad of squads) {
        if (!filtered.includes(squad.id)) filtered.push(squad.id);
      }

      setOrderedIds((current) => (areEqual(current, filtered) ? current : filtered));
      if (!userId) return;

      queryClient.setQueryData(queryKey, (current: { orderedIds?: string[]; updatedAt?: Date | null } | undefined) => ({
        orderedIds: filtered,
        updatedAt: current?.updatedAt ?? null,
      }));
      mutation.mutate(filtered);
    },
    [squads, mutation, queryClient, queryKey, userId],
  );

  return {
    orderedSquads,
    orderedIds,
    persistOrder,
  };
}
