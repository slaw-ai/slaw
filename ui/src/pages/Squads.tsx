import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSquad } from "../context/SquadContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { squadsApi } from "../api/squads";
import { queryKeys } from "../lib/queryKeys";
import { formatCents, relativeTime } from "../lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Pencil,
  Check,
  X,
  Plus,
  MoreHorizontal,
  Trash2,
  Users,
  CircleDot,
  DollarSign,
  Calendar,
} from "lucide-react";

export function Squads() {
  const {
    squads,
    selectedSquadId,
    setSelectedSquadId,
    loading,
    error,
  } = useSquad();
  const { openOnboarding } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: queryKeys.squads.stats,
    queryFn: () => squadsApi.stats(),
  });

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const editMutation = useMutation({
    mutationFn: ({ id, newName }: { id: string; newName: string }) =>
      squadsApi.update(id, { name: newName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.squads.all });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => squadsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.squads.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.squads.stats });
      setConfirmDeleteId(null);
    },
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Squads" }]);
  }, [setBreadcrumbs]);

  function startEdit(squadId: string, currentName: string) {
    setEditingId(squadId);
    setEditName(currentName);
  }

  function saveEdit() {
    if (!editingId || !editName.trim()) return;
    editMutation.mutate({ id: editingId, newName: editName.trim() });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => openOnboarding()}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Squad
        </Button>
      </div>

      <div className="h-6">
        {loading && <p className="text-sm text-muted-foreground">Loading squads...</p>}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
      </div>

      <div className="grid gap-4">
        {squads.map((squad) => {
          const selected = squad.id === selectedSquadId;
          const isEditing = editingId === squad.id;
          const isConfirmingDelete = confirmDeleteId === squad.id;
          const squadStats = stats?.[squad.id];
          const agentCount = squadStats?.agentCount ?? 0;
          const issueCount = squadStats?.issueCount ?? 0;
          const budgetPct =
            squad.budgetMonthlyCents > 0
              ? Math.round(
                  (squad.spentMonthlyCents / squad.budgetMonthlyCents) * 100,
                )
              : 0;

          return (
            <div
              key={squad.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedSquadId(squad.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedSquadId(squad.id);
                }
              }}
              className={`group text-left bg-card border rounded-lg p-5 transition-colors cursor-pointer ${
                selected
                  ? "border-primary ring-1 ring-primary"
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              {/* Header row: name + menu */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div
                      className="flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-7 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={saveEdit}
                        disabled={editMutation.isPending}
                      >
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={cancelEdit}>
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-base">{squad.name}</h3>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          squad.status === "active"
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : squad.status === "paused"
                              ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {squad.status}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(squad.id, squad.name);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  {squad.description && !isEditing && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {squad.description}
                    </p>
                  )}
                </div>

                {/* Three-dot menu */}
                <div onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => startEdit(squad.id, squad.name)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setConfirmDeleteId(squad.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Squad
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-3 sm:gap-5 mt-4 text-sm text-muted-foreground flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  <span>
                    {agentCount} {agentCount === 1 ? "agent" : "agents"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CircleDot className="h-3.5 w-3.5" />
                  <span>
                    {issueCount} {issueCount === 1 ? "issue" : "issues"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 tabular-nums">
                  <DollarSign className="h-3.5 w-3.5" />
                  <span>
                    {formatCents(squad.spentMonthlyCents)}
                    {squad.budgetMonthlyCents > 0
                      ? <> / {formatCents(squad.budgetMonthlyCents)} <span className="text-xs">({budgetPct}%)</span></>
                      : <span className="text-xs ml-1">Unlimited budget</span>}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 ml-auto">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Created {relativeTime(squad.createdAt)}</span>
                </div>
              </div>

              {/* Delete confirmation */}
              {isConfirmingDelete && (
                <div
                  className="mt-4 flex items-center justify-between bg-destructive/5 border border-destructive/20 rounded-md px-4 py-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-sm text-destructive font-medium">
                    Delete this squad and all its data? This cannot be undone.
                  </p>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={deleteMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteMutation.mutate(squad.id)}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
