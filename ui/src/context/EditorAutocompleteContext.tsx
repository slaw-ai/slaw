import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildRoutineMentionHref, buildSkillMentionHref } from "@slaw/shared";
import { squadSkillsApi } from "../api/squadSkills";
import { routinesApi } from "../api/routines";
import { useSquad } from "./SquadContext";
import { queryKeys } from "../lib/queryKeys";

export interface SkillCommandOption {
  id: string;
  kind: "skill";
  skillId: string;
  key: string;
  name: string;
  slug: string;
  description: string | null;
  href: string;
  aliases: string[];
}

export interface RoutineCommandOption {
  id: string;
  kind: "routine";
  routineId: string;
  name: string;
  status: string;
  href: string;
  aliases: string[];
}

export type SlashCommandOption = SkillCommandOption | RoutineCommandOption;

interface EditorAutocompleteContextValue {
  slashCommands: SlashCommandOption[];
}

const EditorAutocompleteContext = createContext<EditorAutocompleteContextValue>({
  slashCommands: [],
});

export function EditorAutocompleteProvider({ children }: { children: ReactNode }) {
  const { selectedSquadId } = useSquad();
  const { data: squadSkills = [] } = useQuery({
    queryKey: selectedSquadId
      ? queryKeys.squadSkills.list(selectedSquadId)
      : ["squad-skills", "__none__"],
    queryFn: () => squadSkillsApi.list(selectedSquadId!),
    enabled: Boolean(selectedSquadId),
  });
  const { data: routines = [] } = useQuery({
    queryKey: selectedSquadId
      ? queryKeys.routines.list(selectedSquadId)
      : ["routines", "__none__", "__all-projects__"],
    queryFn: () => routinesApi.list(selectedSquadId!),
    enabled: Boolean(selectedSquadId),
  });

  const value = useMemo<EditorAutocompleteContextValue>(() => ({
    slashCommands: [
      ...squadSkills.map((skill) => ({
        id: `skill:${skill.id}`,
        kind: "skill" as const,
        skillId: skill.id,
        key: skill.key,
        name: skill.name,
        slug: skill.slug,
        description: skill.description ?? null,
        href: buildSkillMentionHref(skill.id, skill.slug),
        aliases: [skill.slug, skill.name, skill.key],
      })),
      ...routines
        .filter((routine) => routine.status !== "archived")
        .sort((left, right) => left.title.localeCompare(right.title))
        .map((routine) => ({
          id: `routine:${routine.id}`,
          kind: "routine" as const,
          routineId: routine.id,
          name: routine.title,
          status: routine.status,
          href: buildRoutineMentionHref(routine.id),
          aliases: [`routine:${routine.title}`, routine.title, routine.id],
        })),
    ],
  }), [squadSkills, routines]);

  return (
    <EditorAutocompleteContext.Provider value={value}>
      {children}
    </EditorAutocompleteContext.Provider>
  );
}

export function useEditorAutocomplete() {
  return useContext(EditorAutocompleteContext);
}
