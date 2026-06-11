import * as React from "react";
import * as RouterDom from "react-router-dom";
import type { NavigateOptions, To } from "react-router-dom";
import type { Issue } from "@slaw-ai/shared";
import { useSquad } from "@/context/SquadContext";
import { IssueLinkQuicklook } from "@/components/IssueLinkQuicklook";
import {
  applySquadPrefix,
  extractSquadPrefixFromPath,
  normalizeSquadPrefix,
} from "@/lib/squad-routes";
import { parseIssuePathIdFromPath } from "@/lib/issue-reference";

function resolveTo(to: To, squadPrefix: string | null): To {
  if (typeof to === "string") {
    return applySquadPrefix(to, squadPrefix);
  }

  if (to.pathname && to.pathname.startsWith("/")) {
    const pathname = applySquadPrefix(to.pathname, squadPrefix);
    if (pathname !== to.pathname) {
      return { ...to, pathname };
    }
  }

  return to;
}

function useActiveSquadPrefix(): string | null {
  const { selectedSquad } = useSquad();
  const params = RouterDom.useParams<{ squadPrefix?: string }>();
  const location = RouterDom.useLocation();

  if (params.squadPrefix) {
    return normalizeSquadPrefix(params.squadPrefix);
  }

  const pathPrefix = extractSquadPrefixFromPath(location.pathname);
  if (pathPrefix) return pathPrefix;

  return selectedSquad ? normalizeSquadPrefix(selectedSquad.issuePrefix) : null;
}

export * from "react-router-dom";

type SquadLinkProps = React.ComponentProps<typeof RouterDom.Link> & {
  disableIssueQuicklook?: boolean;
  issuePrefetch?: Issue | null;
  issueQuicklookSide?: React.ComponentProps<typeof IssueLinkQuicklook>["issueQuicklookSide"];
  issueQuicklookAlign?: React.ComponentProps<typeof IssueLinkQuicklook>["issueQuicklookAlign"];
};

export const Link = React.forwardRef<HTMLAnchorElement, SquadLinkProps>(
  function SquadLink({
    to,
    disableIssueQuicklook = false,
    issuePrefetch = null,
    issueQuicklookSide,
    issueQuicklookAlign,
    ...props
  }, ref) {
    const squadPrefix = useActiveSquadPrefix();
    const resolvedTo = resolveTo(to, squadPrefix);
    const issuePathId = parseIssuePathIdFromPath(typeof resolvedTo === "string" ? resolvedTo : resolvedTo.pathname);

    if (issuePathId) {
      return (
        <IssueLinkQuicklook
          ref={ref}
          to={resolvedTo}
          issuePathId={issuePathId}
          disableIssueQuicklook={disableIssueQuicklook}
          issuePrefetch={issuePrefetch}
          issueQuicklookSide={issueQuicklookSide}
          issueQuicklookAlign={issueQuicklookAlign}
          {...props}
        />
      );
    }

    return <RouterDom.Link ref={ref} to={resolvedTo} {...props} />;
  },
);

export const NavLink = React.forwardRef<HTMLAnchorElement, React.ComponentProps<typeof RouterDom.NavLink>>(
  function SquadNavLink({ to, ...props }, ref) {
    const squadPrefix = useActiveSquadPrefix();
    return <RouterDom.NavLink ref={ref} to={resolveTo(to, squadPrefix)} {...props} />;
  },
);

export function Navigate({ to, ...props }: React.ComponentProps<typeof RouterDom.Navigate>) {
  const squadPrefix = useActiveSquadPrefix();
  return <RouterDom.Navigate to={resolveTo(to, squadPrefix)} {...props} />;
}

export function useNavigate(): ReturnType<typeof RouterDom.useNavigate> {
  const navigate = RouterDom.useNavigate();
  const squadPrefix = useActiveSquadPrefix();

  return React.useCallback(
    ((to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        navigate(to);
        return;
      }
      navigate(resolveTo(to, squadPrefix), options);
    }) as ReturnType<typeof RouterDom.useNavigate>,
    [navigate, squadPrefix],
  );
}
