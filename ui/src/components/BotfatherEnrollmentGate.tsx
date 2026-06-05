import { Outlet } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { botfatherApi, type BotfatherStatus } from "@/api/botfather";

/**
 * Blocking startup gate (ARCHITECTURE §6.3). When a control tower is configured
 * and enforcement is "enforce", the SLAW UI is blocked behind this screen until
 * the instance is `active`. Standalone or advisory → renders the app normally.
 */
export function BotfatherEnrollmentGate() {
  const statusQuery = useQuery({
    queryKey: ["botfather", "status"],
    queryFn: () => botfatherApi.status(),
    retry: false,
    // poll while gated/pending so the gate auto-clears on approval
    refetchInterval: (q) => {
      const d = q.state.data as BotfatherStatus | undefined;
      if (!d) return 4000;
      return d.gated ? 4000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const data = statusQuery.data;

  // unknown yet, standalone, or not gated → let the app render
  if (!data || !data.gated) return <Outlet />;

  return <GateScreen status={data} />;
}

function GateScreen({ status }: { status: BotfatherStatus }) {
  const copy = stateCopy(status);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-7 py-6 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 font-bold text-white">
            S
          </div>
          <h1 className="text-lg font-semibold">Connect to Control Tower</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This SLAW instance is managed by your organisation and must enrol before use.
          </p>
        </div>

        <div className="px-7 py-6">
          <div className="rounded-xl border border-border bg-muted/40 p-5 text-center">
            {copy.spinner && (
              <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-[3px] border-border border-t-blue-500" />
            )}
            <div className="text-sm font-semibold" style={copy.color ? { color: copy.color } : undefined}>
              {copy.title}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">{copy.detail}</div>
          </div>

          <dl className="mt-5 space-y-2 text-xs">
            <Row k="Control tower" v={status.url ?? "—"} />
            <Row k="Machine" v={status.hostname ?? "—"} />
            <Row k="machineId" v={status.machineId ? `${status.machineId.slice(0, 18)}…` : "—"} mono />
            <Row k="Instance" v={status.instanceId ?? "—"} />
            <Row k="State" v={status.state.toUpperCase()} mono />
          </dl>
        </div>

        <div className="border-t border-border px-7 py-3 text-center text-[11px] text-muted-foreground">
          Enforcement: {status.enforcement ?? "enforce"} · the app unlocks once enrolled
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-b border-border/60 pb-2 last:border-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={mono ? "font-mono text-[11px]" : ""}>{v}</dd>
    </div>
  );
}

function stateCopy(s: BotfatherStatus): {
  title: string;
  detail: string;
  spinner: boolean;
  color?: string;
} {
  switch (s.state) {
    case "connecting":
      return { title: "Contacting control tower…", detail: `Reaching ${s.url ?? "the tower"}.`, spinner: true };
    case "pending":
      return {
        title: "Awaiting administrator approval",
        detail: `Registered as ${s.hostname ?? "this machine"}. An admin must approve it before SLAW can start.`,
        spinner: true,
      };
    case "rejected":
      return {
        title: "Enrolment declined",
        detail: "An administrator declined this machine. Contact your administrator.",
        spinner: false,
        color: "var(--destructive, #dc2626)",
      };
    case "revoked":
      return {
        title: "Access revoked — re-enrolling",
        detail: "An administrator revoked this instance; it has re-submitted for approval.",
        spinner: true,
        color: "#d97706",
      };
    case "unreachable":
      return {
        title: "Control tower unreachable",
        detail: `Cannot reach ${s.url ?? "the tower"}. Retrying… SLAW stays locked until it responds (enforce mode).`,
        spinner: true,
      };
    default:
      return { title: "Connecting…", detail: "", spinner: true };
  }
}
