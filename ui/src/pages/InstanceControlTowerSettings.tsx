import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { botfatherApi, type BotfatherStatus } from "@/api/botfather";
import { Button } from "../components/ui/button";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

const STATE_LABEL: Record<BotfatherStatus["state"], string> = {
  active: "Connected & enrolled",
  pending: "Awaiting administrator approval",
  connecting: "Contacting control tower…",
  rejected: "Enrolment declined",
  revoked: "Access revoked — re-enrolling",
  unreachable: "Control tower unreachable",
  standalone: "Standalone — no control tower",
};

export function InstanceControlTowerSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Instance Settings" }, { label: "Control Tower" }]);
  }, [setBreadcrumbs]);

  const statusQuery = useQuery({
    queryKey: ["botfather", "status"],
    queryFn: () => botfatherApi.status(),
    refetchInterval: 15_000,
  });

  const reenroll = useMutation({
    mutationFn: () => botfatherApi.reenroll(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["botfather", "status"] }),
  });

  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const forceSync = useMutation({
    mutationFn: () => botfatherApi.forceSync(),
    onMutate: () => {
      setSyncMsg(null);
      setSyncErr(null);
    },
    onSuccess: (r) => {
      setSyncMsg(
        `Synced — ${r.upserts} updates, ${r.facts} cost/run events sent; ` +
          `reconciled ${r.entities} records, ${r.healed} cost facts.`,
      );
      queryClient.invalidateQueries({ queryKey: ["botfather", "status"] });
    },
    onError: (e) => setSyncErr(e instanceof Error ? e.message : "Force sync failed"),
  });

  const [url, setUrl] = useState("");
  const [enforcement, setEnforcement] = useState<"enforce" | "advisory">("enforce");
  const [formError, setFormError] = useState<string | null>(null);

  const connect = useMutation({
    mutationFn: () => botfatherApi.connect(url.trim(), enforcement),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["botfather", "status"] });
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Failed to connect"),
  });

  const disconnect = useMutation({
    mutationFn: () => botfatherApi.disconnect(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["botfather", "status"] }),
  });

  const s = statusQuery.data;
  const standalone = !s || s.state === "standalone";

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Radio className="h-4 w-4" /> Control Tower
        </h1>
        <p className="text-sm text-muted-foreground">
          How this instance reports to your organisation&apos;s botfather control tower.
        </p>
      </div>

      {standalone ? (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div>
            <h2 className="text-sm font-semibold">Connect to a control tower</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This instance is <b>standalone</b> — it runs fully locally and reports to no one. Enter your
              organisation&apos;s botfather URL to enrol. It will appear in the tower&apos;s approval queue
              for an admin to approve.
            </p>
          </div>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">
              Control tower URL
              <input
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="https://botfather.your-org.internal"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Enforcement
              <select
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={enforcement}
                onChange={(e) => setEnforcement(e.target.value as "enforce" | "advisory")}
              >
                <option value="enforce">Enforce — block SLAW until approved</option>
                <option value="advisory">Advisory — report but never block</option>
              </select>
            </label>
            {formError && <p className="text-xs text-red-500">{formError}</p>}
            <Button onClick={() => connect.mutate()} disabled={!url.trim() || connect.isPending}>
              {connect.isPending ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </section>
      ) : (
        <>
          <section className="flex items-center gap-3 rounded-xl border border-border bg-card p-5">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                s!.state === "active" ? "bg-emerald-500" : s!.state === "rejected" ? "bg-red-500" : "bg-amber-500"
              }`}
            />
            <div className="flex-1">
              <div className="text-sm font-semibold">{STATE_LABEL[s!.state]}</div>
              <div className="text-xs text-muted-foreground">
                {s!.url}
                {s!.detail ? ` · ${s!.detail}` : ""}
              </div>
            </div>
            <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium uppercase">
              {s!.enrolled ? "enrolled" : s!.state}
            </span>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">This Instance</h2>
            <dl className="space-y-2 text-sm">
              <Row k="Machine" v={s!.hostname ?? "—"} />
              <Row k="machineId" v={s!.machineId ?? "—"} mono />
              <Row k="Instance ID" v={s!.instanceId ?? "—"} />
              <Row k="Enforcement" v={s!.enforcement ?? "enforce"} />
              <Row k="API key" v={s!.enrolled ? "stored in instance credentials" : "not issued"} />
            </dl>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-2 text-sm font-semibold">What gets reported</h2>
            <p className="text-sm text-muted-foreground">
              Squad, agent, project &amp; issue names and statuses; token counts; cost; run states; budget
              alerts. <b className="text-foreground">Never sent:</b> issue descriptions, comments, code,
              diffs, or run logs — that stays on this machine.
            </p>
          </section>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => forceSync.mutate()}
              disabled={forceSync.isPending || s!.state !== "active"}
              title={
                s!.state !== "active"
                  ? "Available once the instance is connected & enrolled"
                  : "Sync all squads, agents, skills, issues, tokens & costs to the tower now"
              }
            >
              {forceSync.isPending ? "Syncing…" : "Force Sync"}
            </Button>
            <Button variant="outline" onClick={() => reenroll.mutate()} disabled={reenroll.isPending}>
              {reenroll.isPending ? "Re-enrolling…" : "Re-enrol"}
            </Button>
            {s!.enforcement === "advisory" ? (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm("Disconnect this instance from the control tower?")) disconnect.mutate();
                }}
                disabled={disconnect.isPending}
              >
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            ) : (
              <span className="self-center text-xs text-muted-foreground">
                Disconnect is managed by your organisation (enforce mode).
              </span>
            )}
          </div>

          {syncMsg && <p className="text-xs text-emerald-600">{syncMsg}</p>}
          {syncErr && <p className="text-xs text-red-500">Force sync failed: {syncErr}</p>}
        </>
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-b border-border/60 pb-2 last:border-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={mono ? "font-mono text-xs" : ""}>{v}</dd>
    </div>
  );
}
