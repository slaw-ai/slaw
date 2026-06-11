import { ChangeEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_SQUAD_ATTACHMENT_MAX_BYTES,
  MAX_SQUAD_ATTACHMENT_MAX_BYTES,
} from "@slaw-ai/shared";
import { useSquad } from "../context/SquadContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { squadsApi } from "../api/squads";
import { assetsApi } from "../api/assets";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Settings, CloudUpload, Download, Upload } from "lucide-react";
import { SquadPatternIcon } from "../components/SquadPatternIcon";
import {
  Field,
  ToggleField,
} from "../components/agent-config-primitives";

const BYTES_PER_MIB = 1024 * 1024;
const DEFAULT_SQUAD_ATTACHMENT_MAX_MIB = DEFAULT_SQUAD_ATTACHMENT_MAX_BYTES / BYTES_PER_MIB;
const MAX_SQUAD_ATTACHMENT_MAX_MIB = MAX_SQUAD_ATTACHMENT_MAX_BYTES / BYTES_PER_MIB;
export function SquadSettings() {
  const {
    squads,
    selectedSquad,
    selectedSquadId,
    setSelectedSquadId
  } = useSquad();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  // General settings local state
  const [squadName, setSquadName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [attachmentMaxMiB, setAttachmentMaxMiB] = useState(String(DEFAULT_SQUAD_ATTACHMENT_MAX_MIB));
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

  // Sync local state from selected squad
  useEffect(() => {
    if (!selectedSquad) return;
    setSquadName(selectedSquad.name);
    setDescription(selectedSquad.description ?? "");
    setBrandColor(selectedSquad.brandColor ?? "");
    setAttachmentMaxMiB(String(Math.round((selectedSquad.attachmentMaxBytes ?? DEFAULT_SQUAD_ATTACHMENT_MAX_BYTES) / BYTES_PER_MIB)));
    setLogoUrl(selectedSquad.logoUrl ?? "");
  }, [selectedSquad]);

  const attachmentMaxBytes = Number.parseInt(attachmentMaxMiB, 10) * BYTES_PER_MIB;
  const attachmentMaxValid =
    Number.isInteger(attachmentMaxBytes)
    && attachmentMaxBytes >= BYTES_PER_MIB
    && attachmentMaxBytes <= MAX_SQUAD_ATTACHMENT_MAX_BYTES;
  const cloudSyncEnabled = experimentalSettings?.enableCloudSync === true;

  const generalDirty =
    !!selectedSquad &&
    (squadName !== selectedSquad.name ||
      description !== (selectedSquad.description ?? "") ||
      brandColor !== (selectedSquad.brandColor ?? "") ||
      attachmentMaxBytes !== (selectedSquad.attachmentMaxBytes ?? DEFAULT_SQUAD_ATTACHMENT_MAX_BYTES));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
      brandColor: string | null;
      attachmentMaxBytes: number;
    }) => squadsApi.update(selectedSquadId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.squads.all });
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      squadsApi.update(selectedSquadId!, {
        requireOperatorApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.squads.all });
    }
  });

  const syncLogoState = (nextLogoUrl: string | null) => {
    setLogoUrl(nextLogoUrl ?? "");
    void queryClient.invalidateQueries({ queryKey: queryKeys.squads.all });
  };

  const logoUploadMutation = useMutation({
    mutationFn: (file: File) =>
      assetsApi
        .uploadSquadLogo(selectedSquadId!, file)
        .then((asset) => squadsApi.update(selectedSquadId!, { logoAssetId: asset.assetId })),
    onSuccess: (squad) => {
      syncLogoState(squad.logoUrl);
      setLogoUploadError(null);
    }
  });

  const clearLogoMutation = useMutation({
    mutationFn: () => squadsApi.update(selectedSquadId!, { logoAssetId: null }),
    onSuccess: (squad) => {
      setLogoUploadError(null);
      syncLogoState(squad.logoUrl);
    }
  });

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setLogoUploadError(null);
    logoUploadMutation.mutate(file);
  }

  function handleClearLogo() {
    clearLogoMutation.mutate();
  }

  const archiveMutation = useMutation({
    mutationFn: ({
      squadId,
      nextSquadId
    }: {
      squadId: string;
      nextSquadId: string | null;
    }) => squadsApi.archive(squadId).then(() => ({ nextSquadId })),
    onSuccess: async ({ nextSquadId }) => {
      if (nextSquadId) {
        setSelectedSquadId(nextSquadId);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.squads.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.squads.stats
      });
    }
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedSquad?.name ?? "Squad", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedSquad?.name]);

  if (!selectedSquad) {
    return (
      <div className="text-sm text-muted-foreground">
        No squad selected. Select a squad from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: squadName.trim(),
      description: description.trim() || null,
      brandColor: brandColor || null,
      attachmentMaxBytes
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Squad Settings</h1>
      </div>

      {/* General */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <Field label="Squad name" hint="The display name for your squad.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={squadName}
              onChange={(e) => setSquadName(e.target.value)}
            />
          </Field>
          <Field
            label="Description"
            hint="Optional description shown in the squad profile."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional squad description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <SquadPatternIcon
                squadName={squadName || selectedSquad.name}
                logoUrl={logoUrl || null}
                brandColor={brandColor || null}
                className="rounded-[14px]"
              />
            </div>
            <div className="flex-1 space-y-3">
              <Field
                label="Logo"
                hint="Upload a PNG, JPEG, WEBP, GIF, or SVG logo image."
              >
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleLogoFileChange}
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-xs"
                  />
                  {logoUrl && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearLogo}
                        disabled={clearLogoMutation.isPending}
                      >
                        {clearLogoMutation.isPending ? "Removing..." : "Remove logo"}
                      </Button>
                    </div>
                  )}
                  {(logoUploadMutation.isError || logoUploadError) && (
                    <span className="text-xs text-destructive">
                      {logoUploadError ??
                        (logoUploadMutation.error instanceof Error
                          ? logoUploadMutation.error.message
                          : "Logo upload failed")}
                    </span>
                  )}
                  {clearLogoMutation.isError && (
                    <span className="text-xs text-destructive">
                      {clearLogoMutation.error.message}
                    </span>
                  )}
                  {logoUploadMutation.isPending && (
                    <span className="text-xs text-muted-foreground">Uploading logo...</span>
                  )}
                </div>
              </Field>
              <Field
                label="Brand color"
                hint="Sets the hue for the squad icon. Leave empty for auto-generated color."
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandColor || "#6366f1"}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={brandColor}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
                        setBrandColor(v);
                      }
                    }}
                    placeholder="Auto"
                    className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  />
                  {brandColor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrandColor("")}
                      className="text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </Field>
              <Field
                label="Attachment size limit"
                hint={`Accepted range: 1-${MAX_SQUAD_ATTACHMENT_MAX_MIB} MiB.`}
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={MAX_SQUAD_ATTACHMENT_MAX_MIB}
                      step={1}
                      value={attachmentMaxMiB}
                      onChange={(e) => setAttachmentMaxMiB(e.target.value)}
                      className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    />
                    <span className="text-xs text-muted-foreground">MiB</span>
                  </div>
                  {!attachmentMaxValid && (
                    <span className="text-xs text-destructive">
                      Enter a whole number from 1 to {MAX_SQUAD_ATTACHMENT_MAX_MIB}.
                    </span>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={generalMutation.isPending || !squadName.trim() || !attachmentMaxValid}
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                  ? generalMutation.error.message
                  : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Hiring */}
      <div className="space-y-4" data-testid="squad-settings-team-section">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Require operator approval for new hires"
            hint="New agent hires stay pending until approved by an operator."
            checked={!!selectedSquad.requireOperatorApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
            toggleTestId="squad-settings-team-approval-toggle"
          />
        </div>
      </div>

      {/* Import / Export */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Squad Packages
        </div>
        <div className="rounded-md border border-border px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Import and export have moved to dedicated pages accessible from the{" "}
            <a href="/org" className="underline hover:text-foreground">Org Chart</a> header.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {cloudSyncEnabled ? (
              <Button size="sm" asChild>
                <a href="/squad/settings/cloud-upstream">
                  <CloudUpload className="mr-1.5 h-3.5 w-3.5" />
                  Send to Slaw Cloud
                </a>
              </Button>
            ) : null}
            <Button size="sm" variant="outline" asChild>
              <a href="/squad/export">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href="/squad/import">
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Import
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">
          Danger Zone
        </div>
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this squad to hide it from the sidebar. This persists in
            the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedSquad.status === "archived"
              }
              onClick={() => {
                if (!selectedSquadId) return;
                const confirmed = window.confirm(
                  `Archive squad "${selectedSquad.name}"? It will be hidden from the sidebar.`
                );
                if (!confirmed) return;
                const nextSquadId =
                  squads.find(
                    (squad) =>
                      squad.id !== selectedSquadId &&
                      squad.status !== "archived"
                  )?.id ?? null;
                archiveMutation.mutate({
                  squadId: selectedSquadId,
                  nextSquadId
                });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedSquad.status === "archived"
                ? "Already archived"
                : "Archive squad"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive squad"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
