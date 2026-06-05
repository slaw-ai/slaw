import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";
import { Layout } from "./components/Layout";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { CloudAccessGate } from "./components/CloudAccessGate";
import { BotfatherEnrollmentGate } from "./components/BotfatherEnrollmentGate";
import { InstanceControlTowerSettings } from "./pages/InstanceControlTowerSettings";
import { Dashboard } from "./pages/Dashboard";
import { DashboardLive } from "./pages/DashboardLive";
import { Squads } from "./pages/Squads";
import { Agents } from "./pages/Agents";
import { AgentDetail } from "./pages/AgentDetail";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { ProjectWorkspaceDetail } from "./pages/ProjectWorkspaceDetail";
import { Workspaces } from "./pages/Workspaces";
import { Issues } from "./pages/Issues";
import { Search } from "./pages/Search";
import { IssueDetail } from "./pages/IssueDetail";
import { IssueChatLongThreadPerf } from "./pages/IssueChatLongThreadPerf";
import { Routines } from "./pages/Routines";
import { RoutineDetail } from "./pages/RoutineDetail";
import { UserProfile } from "./pages/UserProfile";
import { ExecutionWorkspaceDetail } from "./pages/ExecutionWorkspaceDetail";
import { Goals } from "./pages/Goals";
import { GoalDetail } from "./pages/GoalDetail";
import { Approvals } from "./pages/Approvals";
import { ApprovalDetail } from "./pages/ApprovalDetail";
import { Costs } from "./pages/Costs";
import { Activity } from "./pages/Activity";
import { Inbox } from "./pages/Inbox";
import { SquadSettings } from "./pages/SquadSettings";
import { SquadEnvironments } from "./pages/SquadEnvironments";
import { CloudUpstream } from "./pages/CloudUpstream";
import { CloudUpstreamUxLab } from "./pages/CloudUpstreamUxLab";
import { BootstrapSetupUxLab } from "./pages/BootstrapSetupUxLab";
import { SquadSettingsPluginPage } from "./pages/SquadSettingsPluginPage";
import { SquadAccess, SquadAccessLegacyRoute } from "./pages/SquadAccess";
import { SquadInvites } from "./pages/SquadInvites";
import { SquadSkills } from "./pages/SquadSkills";
import { Secrets } from "./pages/Secrets";
import { SquadExport } from "./pages/SquadExport";
import { SquadImport } from "./pages/SquadImport";
import { DesignGuide } from "./pages/DesignGuide";
import { InstanceGeneralSettings } from "./pages/InstanceGeneralSettings";
import { InstanceAccess } from "./pages/InstanceAccess";
import { InstanceSettings } from "./pages/InstanceSettings";
import { InstanceExperimentalSettings } from "./pages/InstanceExperimentalSettings";
import { ProfileSettings } from "./pages/ProfileSettings";
import { PluginManager } from "./pages/PluginManager";
import { PluginSettings } from "./pages/PluginSettings";
import { AdapterManager } from "./pages/AdapterManager";
import { PluginPage } from "./pages/PluginPage";
import { OrgChart } from "./pages/OrgChart";
import { NewAgent } from "./pages/NewAgent";
import { AuthPage } from "./pages/Auth";
import { BoardClaimPage } from "./pages/BoardClaim";
import { CliAuthPage } from "./pages/CliAuth";
import { InviteLandingPage } from "./pages/InviteLanding";
import { JoinRequestQueue } from "./pages/JoinRequestQueue";
import { NotFoundPage } from "./pages/NotFound";
import { useSquad } from "./context/SquadContext";
import { useDialogActions } from "./context/DialogContext";
import { loadLastInboxTab } from "./lib/inbox";
import { shouldRedirectSquadlessRouteToOnboarding } from "./lib/onboarding-route";

function boardRoutes() {
  return (
    <>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="dashboard/live" element={<DashboardLive />} />
      <Route path="onboarding" element={<OnboardingRoutePage />} />
      <Route path="squads" element={<Squads />} />
      <Route path="squad/settings" element={<SquadSettings />} />
      <Route path="squad/settings/environments" element={<SquadEnvironments />} />
      <Route path="squad/settings/cloud-upstream" element={<CloudUpstream />} />
      <Route path="squad/settings/members" element={<SquadAccess />} />
      <Route path="squad/settings/access" element={<SquadAccessLegacyRoute />} />
      <Route path="squad/settings/cloud-upstream" element={<CloudUpstream />} />
      <Route path="squad/settings/invites" element={<SquadInvites />} />
      <Route path="squad/export/*" element={<SquadExport />} />
      <Route path="squad/import" element={<SquadImport />} />
      <Route path="squad/settings/secrets" element={<Secrets />} />
      <Route path="squad/settings/:settingsRoutePath/*" element={<SquadSettingsPluginPage />} />
      <Route path="skills/*" element={<SquadSkills />} />
      <Route path="settings" element={<LegacySettingsRedirect />} />
      <Route path="settings/*" element={<LegacySettingsRedirect />} />
      <Route path="plugins/:pluginId" element={<PluginPage />} />
      <Route path="org" element={<OrgChart />} />
      <Route path="agents" element={<Navigate to="/agents/all" replace />} />
      <Route path="agents/all" element={<Agents />} />
      <Route path="agents/active" element={<Agents />} />
      <Route path="agents/paused" element={<Agents />} />
      <Route path="agents/error" element={<Agents />} />
      <Route path="agents/new" element={<NewAgent />} />
      <Route path="agents/:agentId" element={<AgentDetail />} />
      <Route path="agents/:agentId/:tab" element={<AgentDetail />} />
      <Route path="agents/:agentId/runs/:runId" element={<AgentDetail />} />
      <Route path="projects" element={<Projects />} />
      <Route path="projects/:projectId" element={<ProjectDetail />} />
      <Route path="projects/:projectId/overview" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues" element={<ProjectDetail />} />
      <Route path="projects/:projectId/issues/:filter" element={<ProjectDetail />} />
      <Route path="projects/:projectId/workspaces/:workspaceId" element={<ProjectWorkspaceDetail />} />
      <Route path="projects/:projectId/workspaces" element={<ProjectDetail />} />
      <Route path="projects/:projectId/configuration" element={<ProjectDetail />} />
      <Route path="projects/:projectId/budget" element={<ProjectDetail />} />
      <Route path="workspaces" element={<Workspaces />} />
      <Route path="issues" element={<Issues />} />
      <Route path="search" element={<Search />} />
      <Route path="issues/all" element={<Navigate to="/issues" replace />} />
      <Route path="issues/active" element={<Navigate to="/issues" replace />} />
      <Route path="issues/backlog" element={<Navigate to="/issues" replace />} />
      <Route path="issues/done" element={<Navigate to="/issues" replace />} />
      <Route path="issues/recent" element={<Navigate to="/issues" replace />} />
      <Route path="issues/:issueId" element={<IssueDetail />} />
      {import.meta.env.DEV ? (
        <Route path="tests/perf/long-thread" element={<IssueChatLongThreadPerf />} />
      ) : null}
      <Route path="routines" element={<Routines />} />
      <Route path="routines/:routineId" element={<RoutineDetail />} />
      <Route path="execution-workspaces/:workspaceId" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/services" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/configuration" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/runtime-logs" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/issues" element={<ExecutionWorkspaceDetail />} />
      <Route path="execution-workspaces/:workspaceId/routines" element={<ExecutionWorkspaceDetail />} />
      <Route path="goals" element={<Goals />} />
      <Route path="goals/:goalId" element={<GoalDetail />} />
      <Route path="approvals" element={<Navigate to="/approvals/pending" replace />} />
      <Route path="approvals/pending" element={<Approvals />} />
      <Route path="approvals/all" element={<Approvals />} />
      <Route path="approvals/:approvalId" element={<ApprovalDetail />} />
      <Route path="costs" element={<Costs />} />
      <Route path="activity" element={<Activity />} />
      <Route path="inbox" element={<InboxRootRedirect />} />
      <Route path="inbox/mine" element={<Inbox />} />
      <Route path="inbox/recent" element={<Inbox />} />
      <Route path="inbox/unread" element={<Inbox />} />
      <Route path="inbox/blocked" element={<Inbox />} />
      <Route path="inbox/all" element={<Inbox />} />
      <Route path="inbox/requests" element={<JoinRequestQueue />} />
      <Route path="inbox/new" element={<Navigate to="/inbox/mine" replace />} />
      <Route path="u/:userSlug" element={<UserProfile />} />
      <Route path="design-guide" element={<DesignGuide />} />
      <Route path="instance/settings/adapters" element={<AdapterManager />} />
      <Route path=":pluginRoutePath/*" element={<PluginPage />} />
      <Route path="*" element={<NotFoundPage scope="board" />} />
    </>
  );
}

function InboxRootRedirect() {
  return <Navigate to={`/inbox/${loadLastInboxTab()}`} replace />;
}

function LegacySettingsRedirect() {
  const location = useLocation();
  return <Navigate to={`/instance/settings/general${location.search}${location.hash}`} replace />;
}

function OnboardingRoutePage() {
  const { squads } = useSquad();
  const { openOnboarding } = useDialogActions();
  const { squadPrefix } = useParams<{ squadPrefix?: string }>();
  const matchedSquad = squadPrefix
    ? squads.find((squad) => squad.issuePrefix.toUpperCase() === squadPrefix.toUpperCase()) ?? null
    : null;

  const title = matchedSquad
    ? `Add another agent to ${matchedSquad.name}`
    : squads.length > 0
      ? "Create another squad"
      : "Create your first squad";
  const description = matchedSquad
    ? "Run onboarding again to add an agent and a starter task for this squad."
    : squads.length > 0
      ? "Run onboarding again to create another squad and seed its first agent."
      : "Get started by creating a squad and your first agent.";

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4">
          <Button
            onClick={() =>
              matchedSquad
                ? openOnboarding({ initialStep: 2, squadId: matchedSquad.id })
                : openOnboarding()
            }
          >
            {matchedSquad ? "Add Agent" : "Start Onboarding"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SquadRootRedirect() {
  const { squads, selectedSquad, loading } = useSquad();
  const location = useLocation();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const targetSquad = selectedSquad ?? squads[0] ?? null;
  if (!targetSquad) {
    if (
      shouldRedirectSquadlessRouteToOnboarding({
        pathname: location.pathname,
        hasSquads: false,
      })
    ) {
      return <Navigate to="/onboarding" replace />;
    }
    return <NoSquadsStartPage />;
  }

  return <Navigate to={`/${targetSquad.issuePrefix}/dashboard`} replace />;
}

function UnprefixedBoardRedirect() {
  const location = useLocation();
  const { squads, selectedSquad, loading } = useSquad();

  if (loading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading...</div>;
  }

  const targetSquad = selectedSquad ?? squads[0] ?? null;
  if (!targetSquad) {
    if (
      shouldRedirectSquadlessRouteToOnboarding({
        pathname: location.pathname,
        hasSquads: false,
      })
    ) {
      return <Navigate to="/onboarding" replace />;
    }
    return <NoSquadsStartPage />;
  }

  return (
    <Navigate
      to={`/${targetSquad.issuePrefix}${location.pathname}${location.search}${location.hash}`}
      replace
    />
  );
}

function NoSquadsStartPage() {
  const { openOnboarding } = useDialogActions();
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">
          {t("app.noSquads.title", { defaultValue: "Create your first squad" })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("app.noSquads.description", { defaultValue: "Get started by creating a squad." })}
        </p>
        <div className="mt-4">
          <Button onClick={() => openOnboarding()}>
            {t("app.noSquads.newSquad", { defaultValue: "New Squad" })}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="auth" element={<AuthPage />} />
        <Route path="board-claim/:token" element={<BoardClaimPage />} />
        <Route path="cli-auth/:id" element={<CliAuthPage />} />
        <Route path="invite/:token" element={<InviteLandingPage />} />
        <Route path="tests/perf/long-thread" element={<IssueChatLongThreadPerf />} />
        <Route path="ux-lab/cloud-upstream" element={<CloudUpstreamUxLab />} />
        <Route path="ux-lab/bootstrap-setup" element={<BootstrapSetupUxLab />} />

        <Route element={<BotfatherEnrollmentGate />}>
        <Route element={<CloudAccessGate />}>
          <Route index element={<SquadRootRedirect />} />
          <Route path="onboarding" element={<OnboardingRoutePage />} />
          <Route path="instance" element={<Navigate to="/instance/settings/general" replace />} />
          <Route path="instance/settings" element={<Layout />}>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="profile" element={<ProfileSettings />} />
            <Route path="general" element={<InstanceGeneralSettings />} />
            <Route path="control-tower" element={<InstanceControlTowerSettings />} />
            <Route path="access" element={<InstanceAccess />} />
            <Route path="heartbeats" element={<InstanceSettings />} />
            <Route path="experimental" element={<InstanceExperimentalSettings />} />
            <Route path="plugins" element={<PluginManager />} />
            <Route path="plugins/:pluginId" element={<PluginSettings />} />
            <Route path="adapters" element={<AdapterManager />} />
          </Route>
          <Route path="squads" element={<UnprefixedBoardRedirect />} />
          <Route path="issues" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/:issueId" element={<UnprefixedBoardRedirect />} />
          <Route path="routines" element={<UnprefixedBoardRedirect />} />
          <Route path="routines/:routineId" element={<UnprefixedBoardRedirect />} />
          <Route path="u/:userSlug" element={<UnprefixedBoardRedirect />} />
          <Route path="skills/*" element={<UnprefixedBoardRedirect />} />
          <Route path="settings" element={<LegacySettingsRedirect />} />
          <Route path="settings/*" element={<LegacySettingsRedirect />} />
          <Route path="agents" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/new" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/runs/:runId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/overview" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/issues/:filter" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/workspaces" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/workspaces/:workspaceId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/:projectId/configuration" element={<UnprefixedBoardRedirect />} />
          <Route path="workspaces" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/services" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/configuration" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/runtime-logs" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/issues" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId/routines" element={<UnprefixedBoardRedirect />} />
          <Route path=":squadPrefix" element={<Layout />}>
            {boardRoutes()}
          </Route>
          <Route path="*" element={<NotFoundPage scope="global" />} />
        </Route>
        </Route>
      </Routes>
      <OnboardingWizard />
    </>
  );
}
