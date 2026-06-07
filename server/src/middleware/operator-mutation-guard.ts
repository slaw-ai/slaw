import type { Request, RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_DEV_ORIGINS = [
  "http://localhost:3100",
  "http://127.0.0.1:3100",
];

function parseOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function trustedOriginsForRequest(req: Request) {
  const origins = new Set(DEFAULT_DEV_ORIGINS.map((value) => value.toLowerCase()));
  const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.header("host")?.trim();
  if (host) {
    origins.add(`http://${host}`.toLowerCase());
    origins.add(`https://${host}`.toLowerCase());
  }
  // Behind some reverse proxies the Host / X-Forwarded-Host header may
  // not match the public URL (for example when TLS terminates at the
  // edge and the inbound Host is an internal service name). Trust the
  // explicitly-configured SLAW_PUBLIC_URL when it's set.
  const publicUrl = parseOrigin(process.env.SLAW_PUBLIC_URL?.trim());
  if (publicUrl) origins.add(publicUrl);
  return origins;
}

function isTrustedOperatorMutationRequest(req: Request) {
  const allowedOrigins = trustedOriginsForRequest(req);
  const origin = parseOrigin(req.header("origin"));
  if (origin && allowedOrigins.has(origin)) return true;

  const refererOrigin = parseOrigin(req.header("referer"));
  if (refererOrigin && allowedOrigins.has(refererOrigin)) return true;

  return false;
}

export function operatorMutationGuard(): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    if (req.actor.type !== "operator") {
      next();
      return;
    }

    // Local-trusted mode, operator bearer keys, and trusted Cloud tenant calls are
    // not browser-session requests.
    // In these modes, origin/referer headers can be absent; do not block those mutations.
    if (
      req.actor.source === "local_implicit"
      || req.actor.source === "operator_key"
      || req.actor.source === "cloud_tenant"
    ) {
      next();
      return;
    }

    if (!isTrustedOperatorMutationRequest(req)) {
      res.status(403).json({ error: "Operator mutation requires trusted browser origin" });
      return;
    }

    next();
  };
}
