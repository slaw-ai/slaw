import { readBotfatherConfigSection } from "../../config-file.js";
import { readBotfatherCredentials } from "./credentials.js";

/**
 * Tower-only authoring lock predicate. An instance is "tower-governed" — and so
 * local skill authoring/import is disabled — when a control-tower URL is
 * configured AND the instance is enrolled (active credentials with an apiKey
 * exist). Standalone or not-yet-enrolled instances are NOT governed, so their
 * local skill authoring keeps working exactly as before.
 *
 * See DESIGN-skill-registry.md §8.1. Kept tiny + dependency-injectable so the
 * decision is unit-testable without touching disk.
 */
export function isTowerGoverned(
  deps: {
    readConfigSection?: typeof readBotfatherConfigSection;
    readCredentials?: typeof readBotfatherCredentials;
  } = {},
): boolean {
  const readConfig = deps.readConfigSection ?? readBotfatherConfigSection;
  const readCreds = deps.readCredentials ?? readBotfatherCredentials;
  const section = readConfig();
  const hasTowerUrl = typeof section?.url === "string" && section.url.length > 0;
  if (!hasTowerUrl) return false;
  const creds = readCreds();
  return Boolean(creds?.apiKey);
}
