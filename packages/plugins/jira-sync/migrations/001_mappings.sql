-- Jira Sync plugin — issue mapping table.
--
-- Plugin migrations must reference the host-derived namespace by its fully
-- qualified name. For plugin id "slaw.jira-sync" with namespaceSlug
-- "jira_sync", the host computes:
--   plugin_jira_sync_<sha256(pluginId)[:10]> = plugin_jira_sync_58648c8018
-- (see server/src/services/plugin-database.ts#derivePluginDatabaseNamespace).

CREATE TABLE IF NOT EXISTS plugin_jira_sync_58648c8018.jira_issue_mappings (
  id            SERIAL PRIMARY KEY,
  slaw_issue_id TEXT NOT NULL,
  jira_key      TEXT NOT NULL UNIQUE,
  jira_id       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jira_mappings_slaw_issue_id
  ON plugin_jira_sync_58648c8018.jira_issue_mappings (slaw_issue_id);
