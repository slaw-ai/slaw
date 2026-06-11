import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronsUpDown,
  GripVertical,
  LogOut,
  Plus,
  Settings,
  UserPlus,
} from "lucide-react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Squad } from "@slaw-ai/shared";
import { Link, useLocation, useNavigate } from "@/lib/router";
import { authApi } from "@/api/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSquad } from "@/context/SquadContext";
import { useDialogActions } from "@/context/DialogContext";
import { useSquadOrder } from "@/hooks/useSquadOrder";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { useSidebar } from "../context/SidebarContext";
import { SquadPatternIcon } from "./SquadPatternIcon";

interface SidebarSquadMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function WorkspaceIcon({ squad }: { squad: Squad }) {
  return (
    <SquadPatternIcon
      squadName={squad.name}
      logoUrl={squad.logoUrl}
      brandColor={squad.brandColor}
      className="size-5 shrink-0 rounded-md text-[11px]"
    />
  );
}

function SortableSquadItem({
  squad,
  isEditing,
  isSelected,
  onSelect,
}: {
  squad: Squad;
  isEditing: boolean;
  isSelected: boolean;
  onSelect: (squad: Squad) => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: squad.id, disabled: !isEditing });

  return (
    <DropdownMenuItem
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      onSelect={(event) => {
        if (isEditing) {
          event.preventDefault();
          return;
        }
        onSelect(squad);
      }}
      className={cn(
        "min-w-0 gap-2 py-2",
        isEditing && "cursor-grab",
        isDragging && "opacity-80",
        isSelected && "bg-accent text-accent-foreground",
      )}
    >
      <WorkspaceIcon squad={squad} />
      <span className="min-w-0 flex-1 truncate">{squad.name}</span>
      {isEditing ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Reorder ${squad.name}`}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {squad.issuePrefix}
          </span>
          {isSelected ? <Check className="size-4 text-muted-foreground" /> : null}
        </>
      )}
    </DropdownMenuItem>
  );
}

export function SidebarSquadMenu({ open: controlledOpen, onOpenChange }: SidebarSquadMenuProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const queryClient = useQueryClient();
  const { squads, selectedSquad, setSelectedSquadId } = useSquad();
  const { openOnboarding } = useDialogActions();
  const { isMobile, setSidebarOpen } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
  );
  const sidebarSquads = useMemo(
    () => squads.filter((squad) => squad.status !== "archived"),
    [squads],
  );
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;
  const { orderedSquads, persistOrder } = useSquadOrder({
    squads: sidebarSquads,
    userId: currentUserId,
  });

  const signOutMutation = useMutation({
    mutationFn: () => authApi.signOut(),
    onSuccess: async () => {
      setOpen(false);
      if (isMobile) setSidebarOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
    },
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setIsEditingOrder(false);
    setOpen(nextOpen);
  }

  function closeNavigationChrome() {
    setOpen(false);
    setIsEditingOrder(false);
    if (isMobile) setSidebarOpen(false);
  }

  function selectSquad(squad: Squad) {
    const pathPrefix = location.pathname.split("/")[1]?.toUpperCase();
    const isSquadRoute = sidebarSquads.some((sidebarSquad) => (
      sidebarSquad.issuePrefix.toUpperCase() === pathPrefix
    ));
    const shouldLeaveCurrentRoute = squad.id !== selectedSquad?.id
      && (location.pathname.startsWith("/instance/") || isSquadRoute);

    setSelectedSquadId(squad.id);
    setOpen(false);
    if (isMobile) setSidebarOpen(false);
    if (shouldLeaveCurrentRoute) {
      navigate(`/${squad.issuePrefix}/dashboard`);
    }
  }

  function addSquad() {
    setOpen(false);
    if (isMobile) setSidebarOpen(false);
    openOnboarding();
  }

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const ids = orderedSquads.map((squad) => squad.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      persistOrder(arrayMove(ids, oldIndex, newIndex));
    },
    [orderedSquads, persistOrder],
  );

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 flex-1 justify-start gap-2 px-2 text-left"
          aria-label={selectedSquad ? `Open ${selectedSquad.name} workspace switcher` : "Open workspace switcher"}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {selectedSquad ? <WorkspaceIcon squad={selectedSquad} /> : null}
            <span className="truncate text-sm font-bold text-foreground">
              {selectedSquad?.name ?? "Select workspace"}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-64 p-1">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <DropdownMenuLabel className="p-0 text-[11px] font-semibold uppercase text-muted-foreground">
            Switch workspace
          </DropdownMenuLabel>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsEditingOrder((current) => !current);
            }}
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {isEditingOrder ? "Done" : "Edit"}
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedSquads.map((squad) => squad.id)}
              strategy={verticalListSortingStrategy}
            >
              {orderedSquads.map((squad) => (
                <SortableSquadItem
                  key={squad.id}
                  squad={squad}
                  isEditing={isEditingOrder}
                  isSelected={squad.id === selectedSquad?.id}
                  onSelect={selectSquad}
                />
              ))}
            </SortableContext>
          </DndContext>
          {orderedSquads.length === 0 ? (
            <DropdownMenuItem disabled>No workspaces</DropdownMenuItem>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={addSquad}
          className="gap-2 py-2 text-muted-foreground"
          disabled={isEditingOrder}
        >
          <Plus className="size-4" />
          <span>Add squad...</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild disabled={isEditingOrder}>
          <Link
            to="/squad/settings/invites"
            onClick={(event) => {
              if (isEditingOrder) {
                event.preventDefault();
                return;
              }
              closeNavigationChrome();
            }}
          >
            <UserPlus className="size-4" />
            <span className="truncate">
              {selectedSquad ? `Invite people to ${selectedSquad.name}` : "Invite people"}
            </span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild disabled={isEditingOrder}>
          <Link
            to="/squad/settings"
            onClick={(event) => {
              if (isEditingOrder) {
                event.preventDefault();
                return;
              }
              closeNavigationChrome();
            }}
          >
            <Settings className="size-4" />
            <span>Squad settings</span>
          </Link>
        </DropdownMenuItem>
        {session?.session ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => signOutMutation.mutate()}
              disabled={isEditingOrder || signOutMutation.isPending}
            >
              <LogOut className="size-4" />
              <span>{signOutMutation.isPending ? "Signing out..." : "Sign out"}</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
