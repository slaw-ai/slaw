CREATE TABLE IF NOT EXISTS plugin_llm_wiki_d7b765c1a5.wiki_spaces (
  id uuid PRIMARY KEY,
  squad_id uuid NOT NULL REFERENCES public.squads(id) ON DELETE CASCADE,
  wiki_id text NOT NULL DEFAULT 'default',
  slug text NOT NULL,
  display_name text NOT NULL,
  space_type text NOT NULL DEFAULT 'local_folder',
  folder_mode text NOT NULL DEFAULT 'managed_subfolder',
  root_folder_key text NOT NULL DEFAULT 'wiki-root',
  path_prefix text,
  configured_root_path text,
  access_scope text NOT NULL DEFAULT 'shared',
  owner_user_id text,
  owner_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  team_key text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (squad_id, wiki_id, slug)
);

CREATE INDEX IF NOT EXISTS wiki_spaces_squad_status_idx
  ON plugin_llm_wiki_d7b765c1a5.wiki_spaces (squad_id, wiki_id, status);

WITH wiki_pairs AS (
  SELECT squad_id, wiki_id FROM plugin_llm_wiki_d7b765c1a5.wiki_instances
  UNION
  SELECT squad_id, wiki_id FROM plugin_llm_wiki_d7b765c1a5.wiki_sources
  UNION
  SELECT squad_id, wiki_id FROM plugin_llm_wiki_d7b765c1a5.wiki_pages
  UNION
  SELECT squad_id, wiki_id FROM plugin_llm_wiki_d7b765c1a5.wiki_page_revisions
  UNION
  SELECT squad_id, wiki_id FROM plugin_llm_wiki_d7b765c1a5.wiki_operations
  UNION
  SELECT squad_id, wiki_id FROM plugin_llm_wiki_d7b765c1a5.wiki_query_sessions
  UNION
  SELECT squad_id, wiki_id FROM plugin_llm_wiki_d7b765c1a5.slaw_distillation_cursors
  UNION
  SELECT squad_id, wiki_id FROM plugin_llm_wiki_d7b765c1a5.slaw_distillation_work_items
  UNION
  SELECT squad_id, wiki_id FROM plugin_llm_wiki_d7b765c1a5.slaw_distillation_runs
  UNION
  SELECT squad_id, wiki_id FROM plugin_llm_wiki_d7b765c1a5.slaw_source_snapshots
  UNION
  SELECT squad_id, wiki_id FROM plugin_llm_wiki_d7b765c1a5.slaw_page_bindings
)
INSERT INTO plugin_llm_wiki_d7b765c1a5.wiki_spaces
  (id, squad_id, wiki_id, slug, display_name, space_type, folder_mode, root_folder_key, path_prefix, access_scope, status)
SELECT (
    substr(md5(squad_id::text || ':' || wiki_id || ':default'), 1, 8) || '-' ||
    substr(md5(squad_id::text || ':' || wiki_id || ':default'), 9, 4) || '-' ||
    '4' || substr(md5(squad_id::text || ':' || wiki_id || ':default'), 14, 3) || '-' ||
    '8' || substr(md5(squad_id::text || ':' || wiki_id || ':default'), 18, 3) || '-' ||
    substr(md5(squad_id::text || ':' || wiki_id || ':default'), 21, 12)
  )::uuid,
  squad_id,
  wiki_id,
  'default',
  'default',
  'local_folder',
  'managed_subfolder',
  'wiki-root',
  NULL,
  'shared',
  'active'
FROM wiki_pairs
ON CONFLICT (squad_id, wiki_id, slug) DO NOTHING;

ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_sources ADD COLUMN IF NOT EXISTS space_id uuid;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_pages ADD COLUMN IF NOT EXISTS space_id uuid;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_page_revisions ADD COLUMN IF NOT EXISTS space_id uuid;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_operations ADD COLUMN IF NOT EXISTS space_id uuid;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_query_sessions ADD COLUMN IF NOT EXISTS space_id uuid;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_cursors ADD COLUMN IF NOT EXISTS space_id uuid;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_work_items ADD COLUMN IF NOT EXISTS space_id uuid;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_runs ADD COLUMN IF NOT EXISTS space_id uuid;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_source_snapshots ADD COLUMN IF NOT EXISTS space_id uuid;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_page_bindings ADD COLUMN IF NOT EXISTS space_id uuid;

UPDATE plugin_llm_wiki_d7b765c1a5.wiki_sources t
SET space_id = s.id
FROM plugin_llm_wiki_d7b765c1a5.wiki_spaces s
WHERE t.squad_id = s.squad_id AND t.wiki_id = s.wiki_id AND s.slug = 'default' AND t.space_id IS NULL;

UPDATE plugin_llm_wiki_d7b765c1a5.wiki_pages t
SET space_id = s.id
FROM plugin_llm_wiki_d7b765c1a5.wiki_spaces s
WHERE t.squad_id = s.squad_id AND t.wiki_id = s.wiki_id AND s.slug = 'default' AND t.space_id IS NULL;

UPDATE plugin_llm_wiki_d7b765c1a5.wiki_page_revisions t
SET space_id = s.id
FROM plugin_llm_wiki_d7b765c1a5.wiki_spaces s
WHERE t.squad_id = s.squad_id AND t.wiki_id = s.wiki_id AND s.slug = 'default' AND t.space_id IS NULL;

UPDATE plugin_llm_wiki_d7b765c1a5.wiki_operations t
SET space_id = s.id
FROM plugin_llm_wiki_d7b765c1a5.wiki_spaces s
WHERE t.squad_id = s.squad_id AND t.wiki_id = s.wiki_id AND s.slug = 'default' AND t.space_id IS NULL;

UPDATE plugin_llm_wiki_d7b765c1a5.wiki_query_sessions t
SET space_id = s.id
FROM plugin_llm_wiki_d7b765c1a5.wiki_spaces s
WHERE t.squad_id = s.squad_id AND t.wiki_id = s.wiki_id AND s.slug = 'default' AND t.space_id IS NULL;

UPDATE plugin_llm_wiki_d7b765c1a5.slaw_distillation_cursors t
SET space_id = s.id
FROM plugin_llm_wiki_d7b765c1a5.wiki_spaces s
WHERE t.squad_id = s.squad_id AND t.wiki_id = s.wiki_id AND s.slug = 'default' AND t.space_id IS NULL;

UPDATE plugin_llm_wiki_d7b765c1a5.slaw_distillation_work_items t
SET space_id = s.id
FROM plugin_llm_wiki_d7b765c1a5.wiki_spaces s
WHERE t.squad_id = s.squad_id AND t.wiki_id = s.wiki_id AND s.slug = 'default' AND t.space_id IS NULL;

UPDATE plugin_llm_wiki_d7b765c1a5.slaw_distillation_runs t
SET space_id = s.id
FROM plugin_llm_wiki_d7b765c1a5.wiki_spaces s
WHERE t.squad_id = s.squad_id AND t.wiki_id = s.wiki_id AND s.slug = 'default' AND t.space_id IS NULL;

UPDATE plugin_llm_wiki_d7b765c1a5.slaw_source_snapshots t
SET space_id = s.id
FROM plugin_llm_wiki_d7b765c1a5.wiki_spaces s
WHERE t.squad_id = s.squad_id AND t.wiki_id = s.wiki_id AND s.slug = 'default' AND t.space_id IS NULL;

UPDATE plugin_llm_wiki_d7b765c1a5.slaw_page_bindings t
SET space_id = s.id
FROM plugin_llm_wiki_d7b765c1a5.wiki_spaces s
WHERE t.squad_id = s.squad_id AND t.wiki_id = s.wiki_id AND s.slug = 'default' AND t.space_id IS NULL;

ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_sources ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_pages ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_page_revisions ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_operations ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_query_sessions ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_cursors ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_work_items ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_runs ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_source_snapshots ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_page_bindings ALTER COLUMN space_id SET NOT NULL;

ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_pages
  DROP CONSTRAINT IF EXISTS wiki_pages_squad_id_wiki_id_path_key;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_cursors
  DROP CONSTRAINT IF EXISTS slaw_distillation_cursors_squad_id_wiki_id_source_scope_sco_key;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_work_items
  DROP CONSTRAINT IF EXISTS slaw_distillation_work_items_squad_id_wiki_id_idempotency_k_key;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_page_bindings
  DROP CONSTRAINT IF EXISTS slaw_page_bindings_squad_id_wiki_id_page_path_key;

ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_pages
  DROP CONSTRAINT IF EXISTS wiki_pages_squad_wiki_space_path_key;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_pages
  ADD CONSTRAINT wiki_pages_squad_wiki_space_path_key UNIQUE (squad_id, wiki_id, space_id, path);
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_cursors
  DROP CONSTRAINT IF EXISTS distillation_cursors_squad_wiki_space_scope_key;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_cursors
  ADD CONSTRAINT distillation_cursors_squad_wiki_space_scope_key UNIQUE (squad_id, wiki_id, space_id, source_scope, scope_key, source_kind);
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_work_items
  DROP CONSTRAINT IF EXISTS distillation_work_items_squad_wiki_space_idempotency_key;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_work_items
  ADD CONSTRAINT distillation_work_items_squad_wiki_space_idempotency_key UNIQUE (squad_id, wiki_id, space_id, idempotency_key);
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_page_bindings
  DROP CONSTRAINT IF EXISTS page_bindings_squad_wiki_space_page_path_key;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_page_bindings
  ADD CONSTRAINT page_bindings_squad_wiki_space_page_path_key UNIQUE (squad_id, wiki_id, space_id, page_path);

ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_sources
  DROP CONSTRAINT IF EXISTS wiki_sources_space_id_fk;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_sources
  ADD CONSTRAINT wiki_sources_space_id_fk FOREIGN KEY (space_id) REFERENCES plugin_llm_wiki_d7b765c1a5.wiki_spaces(id) ON DELETE CASCADE;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_pages
  DROP CONSTRAINT IF EXISTS wiki_pages_space_id_fk;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_pages
  ADD CONSTRAINT wiki_pages_space_id_fk FOREIGN KEY (space_id) REFERENCES plugin_llm_wiki_d7b765c1a5.wiki_spaces(id) ON DELETE CASCADE;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_page_revisions
  DROP CONSTRAINT IF EXISTS wiki_page_revisions_space_id_fk;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_page_revisions
  ADD CONSTRAINT wiki_page_revisions_space_id_fk FOREIGN KEY (space_id) REFERENCES plugin_llm_wiki_d7b765c1a5.wiki_spaces(id) ON DELETE CASCADE;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_operations
  DROP CONSTRAINT IF EXISTS wiki_operations_space_id_fk;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_operations
  ADD CONSTRAINT wiki_operations_space_id_fk FOREIGN KEY (space_id) REFERENCES plugin_llm_wiki_d7b765c1a5.wiki_spaces(id) ON DELETE CASCADE;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_query_sessions
  DROP CONSTRAINT IF EXISTS wiki_query_sessions_space_id_fk;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.wiki_query_sessions
  ADD CONSTRAINT wiki_query_sessions_space_id_fk FOREIGN KEY (space_id) REFERENCES plugin_llm_wiki_d7b765c1a5.wiki_spaces(id) ON DELETE CASCADE;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_cursors
  DROP CONSTRAINT IF EXISTS slaw_distillation_cursors_space_id_fk;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_cursors
  ADD CONSTRAINT slaw_distillation_cursors_space_id_fk FOREIGN KEY (space_id) REFERENCES plugin_llm_wiki_d7b765c1a5.wiki_spaces(id) ON DELETE CASCADE;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_work_items
  DROP CONSTRAINT IF EXISTS slaw_distillation_work_items_space_id_fk;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_work_items
  ADD CONSTRAINT slaw_distillation_work_items_space_id_fk FOREIGN KEY (space_id) REFERENCES plugin_llm_wiki_d7b765c1a5.wiki_spaces(id) ON DELETE CASCADE;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_runs
  DROP CONSTRAINT IF EXISTS slaw_distillation_runs_space_id_fk;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_distillation_runs
  ADD CONSTRAINT slaw_distillation_runs_space_id_fk FOREIGN KEY (space_id) REFERENCES plugin_llm_wiki_d7b765c1a5.wiki_spaces(id) ON DELETE CASCADE;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_source_snapshots
  DROP CONSTRAINT IF EXISTS slaw_source_snapshots_space_id_fk;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_source_snapshots
  ADD CONSTRAINT slaw_source_snapshots_space_id_fk FOREIGN KEY (space_id) REFERENCES plugin_llm_wiki_d7b765c1a5.wiki_spaces(id) ON DELETE CASCADE;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_page_bindings
  DROP CONSTRAINT IF EXISTS slaw_page_bindings_space_id_fk;
ALTER TABLE plugin_llm_wiki_d7b765c1a5.slaw_page_bindings
  ADD CONSTRAINT slaw_page_bindings_space_id_fk FOREIGN KEY (space_id) REFERENCES plugin_llm_wiki_d7b765c1a5.wiki_spaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS wiki_sources_space_idx ON plugin_llm_wiki_d7b765c1a5.wiki_sources (squad_id, wiki_id, space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wiki_operations_space_idx ON plugin_llm_wiki_d7b765c1a5.wiki_operations (squad_id, wiki_id, space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wiki_query_sessions_space_idx ON plugin_llm_wiki_d7b765c1a5.wiki_query_sessions (squad_id, wiki_id, space_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS distillation_runs_space_idx ON plugin_llm_wiki_d7b765c1a5.slaw_distillation_runs (squad_id, wiki_id, space_id, created_at DESC);
