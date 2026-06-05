import { ChevronsUpDown, Plus, Settings } from "lucide-react";
import { Link } from "@/lib/router";
import { useSquad } from "../context/SquadContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useState } from "react";

function statusDotColor(status?: string): string {
  switch (status) {
    case "active":
      return "bg-green-400";
    case "paused":
      return "bg-yellow-400";
    case "archived":
      return "bg-neutral-400";
    default:
      return "bg-green-400";
  }
}

interface SquadSwitcherProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SquadSwitcher({ open: controlledOpen, onOpenChange }: SquadSwitcherProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const { squads, selectedSquad, setSelectedSquadId } = useSquad();
  const sidebarSquads = squads.filter((squad) => squad.status !== "archived");
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between px-2 py-1.5 h-auto text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            {selectedSquad && (
              <span className={`h-2 w-2 rounded-full shrink-0 ${statusDotColor(selectedSquad.status)}`} />
            )}
            <span className="text-sm font-medium truncate">
              {selectedSquad?.name ?? "Select squad"}
            </span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[220px]">
        <DropdownMenuLabel>Squads</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sidebarSquads.map((squad) => (
          <DropdownMenuItem
            key={squad.id}
            onClick={() => setSelectedSquadId(squad.id)}
            className={squad.id === selectedSquad?.id ? "bg-accent" : ""}
          >
            <span className={`h-2 w-2 rounded-full shrink-0 mr-2 ${statusDotColor(squad.status)}`} />
            <span className="truncate">{squad.name}</span>
          </DropdownMenuItem>
        ))}
        {sidebarSquads.length === 0 && (
          <DropdownMenuItem disabled>No squads</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/squad/settings" className="no-underline text-inherit">
            <Settings className="h-4 w-4 mr-2" />
            Squad Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/squads" className="no-underline text-inherit">
            <Plus className="h-4 w-4 mr-2" />
            Manage Squads
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
