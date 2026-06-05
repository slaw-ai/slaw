import { useEffect } from "react";
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
        <section className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            This instance is <b>standalone</b> — no control tower is configured. It runs fully locally and
            reports to no one. Set <code className="font-mono text-xs">botfather.url</code> in your instance
            config to enrol with a tower.
          </p>
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

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => reenroll.mutate()} disabled={reenroll.isPending}>
              {reenroll.isPending ? "Re-enrolling…" : "Re-enrol"}
            </Button>
            {s!.enforcement === "enforce" && (
              <span className="self-center text-xs text-muted-foreground">
                Disconnect is managed by your organisation (enforce mode).
              </span>
            )}
          </div>
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
