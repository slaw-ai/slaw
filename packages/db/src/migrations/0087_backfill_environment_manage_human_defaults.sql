INSERT INTO "principal_permission_grants" (
  "squad_id",
  "principal_type",
  "principal_id",
  "permission_key",
  "scope",
  "granted_by_user_id",
  "created_at",
  "updated_at"
)
SELECT
  "squad_id",
  'user',
  "principal_id",
  'environments:manage',
  NULL,
  NULL,
  now(),
  now()
FROM "squad_memberships"
WHERE "principal_type" = 'user'
  AND "status" = 'active'
  AND "membership_role" IN ('owner', 'admin')
ON CONFLICT (
  "squad_id",
  "principal_type",
  "principal_id",
  "permission_key"
) DO NOTHING;
