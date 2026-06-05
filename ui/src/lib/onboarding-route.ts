type OnboardingRouteSquad = {
  id: string;
  issuePrefix: string;
};

export function isOnboardingPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 1) {
    return segments[0]?.toLowerCase() === "onboarding";
  }

  if (segments.length === 2) {
    return segments[1]?.toLowerCase() === "onboarding";
  }

  return false;
}

export function resolveRouteOnboardingOptions(params: {
  pathname: string;
  squadPrefix?: string;
  squads: OnboardingRouteSquad[];
}): { initialStep: 1 | 2; squadId?: string } | null {
  const { pathname, squadPrefix, squads } = params;

  if (!isOnboardingPath(pathname)) return null;

  if (!squadPrefix) {
    return { initialStep: 1 };
  }

  const matchedSquad =
    squads.find(
      (squad) =>
        squad.issuePrefix.toUpperCase() === squadPrefix.toUpperCase(),
    ) ?? null;

  if (!matchedSquad) {
    return { initialStep: 1 };
  }

  return { initialStep: 2, squadId: matchedSquad.id };
}

export function shouldRedirectSquadlessRouteToOnboarding(params: {
  pathname: string;
  hasSquads: boolean;
}): boolean {
  return !params.hasSquads && !isOnboardingPath(params.pathname);
}
