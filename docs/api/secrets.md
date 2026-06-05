---
title: Secrets
summary: Secrets CRUD
---

Manage encrypted secrets that agents reference in their environment configuration.

## List Secrets

```
GET /api/squads/{squadId}/secrets
```

Returns secret metadata (not decrypted values).

## Create Secret

```
POST /api/squads/{squadId}/secrets
{
  "name": "anthropic-api-key",
  "value": "sk-ant-..."
}
```

The value is encrypted at rest. Only the secret ID and metadata are returned.

To link a provider-owned secret without copying the value into Slaw, create
an external-reference secret:

```json
{
  "name": "prod-stripe-key",
  "provider": "aws_secrets_manager",
  "managedMode": "external_reference",
  "externalRef": "arn:aws:secretsmanager:us-east-1:123456789012:secret:slaw/prod/stripe",
  "providerVersionRef": "version-id-or-label"
}
```

Slaw stores the provider reference and a non-sensitive fingerprint only.
The value is resolved, when the provider is configured, through the server
runtime path that enforces binding context and records access events.

## Provider Health

```
GET /api/squads/{squadId}/secret-providers/health
```

Returns provider setup diagnostics, warnings, and local backup guidance. Health
responses must not include secret values or provider credentials.

For `aws_secrets_manager`, an unready health response names the missing
non-secret provider environment variables, the AWS SDK default credential source
expected by the server runtime, and the custody rule that AWS bootstrap
credentials must not be stored in Slaw `squad_secrets`.

The equivalent CLI check is:

```sh
pnpm slaw secrets doctor --squad-id {squadId}
```

## Provider Vaults

Provider vaults are named, squad-scoped configurations that route secret
material to one of the supported provider backends. See the
[secrets deploy guide](/deploy/secrets#provider-vaults) for the operator model
and custody rules.

All routes below require board auth and squad access. Mutating routes emit
`secret_provider_config.*` activity-log entries. No route in this surface
returns provider credential values; submitting credential-shaped fields in
`config` is rejected at validation time.

### List Vaults

```
GET /api/squads/{squadId}/secret-provider-configs
```

Returns every vault for the squad (including disabled rows for audit), each
with id, provider, displayName, status, isDefault, non-sensitive `config`,
latest health snapshot (`healthStatus`, `healthCheckedAt`, `healthMessage`,
`healthDetails`), `disabledAt`, and audit columns.

### Create Vault

```
POST /api/squads/{squadId}/secret-provider-configs
{
  "provider": "aws_secrets_manager",
  "displayName": "Prod US-East",
  "isDefault": true,
  "config": {
    "region": "us-east-1",
    "namespace": "slaw",
    "secretNamePrefix": "slaw",
    "kmsKeyId": "arn:aws:kms:us-east-1:123456789012:key/abcd-...",
    "environmentTag": "production"
  }
}
```

Per-provider `config` shapes:

- `local_encrypted`: optional `backupReminderAcknowledged: boolean`.
- `aws_secrets_manager`: required `region`; optional `namespace`,
  `secretNamePrefix`, `kmsKeyId`, `ownerTag`, `environmentTag`.
- `gcp_secret_manager` (coming soon): optional `projectId`, `location`,
  `namespace`, `secretNamePrefix`.
- `vault` (coming soon): optional origin-only HTTPS `address`, `namespace`,
  `mountPath`, `secretPathPrefix`. `address` values with embedded credentials,
  paths, query strings, or fragments are rejected.

`status` defaults to `ready` for `local_encrypted` and `aws_secrets_manager`,
and to `coming_soon` for `gcp_secret_manager` and `vault`. Coming-soon and
disabled vaults cannot be marked `isDefault`. Setting `isDefault: true` clears
the previous default for the same provider in the same transaction.

### Get Vault

```
GET /api/secret-provider-configs/{id}
```

### Update Vault

```
PATCH /api/secret-provider-configs/{id}
{
  "displayName": "Prod US-East-2",
  "config": {
    "region": "us-east-2",
    "kmsKeyId": "arn:aws:kms:us-east-2:123456789012:key/abcd-..."
  }
}
```

`config` is replaced wholesale on update — pass the full provider config
payload, not a partial diff. Status transitions for `gcp_secret_manager` and
`vault` are constrained to `coming_soon` and `disabled` until their runtime
modules ship.

### Disable Vault

```
DELETE /api/secret-provider-configs/{id}
```

Soft-deletes the vault: status flips to `disabled`, `isDefault` clears, and
`disabledAt` is stamped. Disabled vaults remain in `GET` results for audit
purposes but are no longer offered in the secret create/rotate flow.

### Set Default

```
POST /api/secret-provider-configs/{id}/default
```

Marks the target vault as the default for its provider family and clears the
previous default. Returns 422 when the target is `coming_soon` or `disabled`.

### Run Health Check

```
POST /api/secret-provider-configs/{id}/health
```

Runs a provider-specific health probe and persists the result on the vault.
Response shape:

```json
{
  "configId": "<uuid>",
  "provider": "aws_secrets_manager",
  "status": "ready" | "warning" | "error" | "coming_soon" | "disabled",
  "message": "Provider vault is ready to handle managed writes",
  "details": {
    "code": "provider_ready",
    "message": "...",
    "guidance": ["..."]
  },
  "checkedAt": "2026-05-06T14:00:00.000Z"
}
```

Health responses never include provider credentials or secret values. For AWS
vaults, `details.guidance` may include missing non-secret env names and the
expected AWS SDK credential source; coming-soon vaults always return
`status: "coming_soon"` with `code: "runtime_locked"` and never call into
provider modules.

### Selecting A Vault When Creating Or Rotating Secrets

`POST /api/squads/{squadId}/secrets` and
`POST /api/secrets/{secretId}/rotate` both accept an optional
`providerConfigId` field that pins the secret to a specific vault. When
omitted (or null), the operation runs through the deployment-level provider
configuration — the same path existing installs already use. The board UI
preselects the squad's default vault for the chosen provider before
submitting, so callers should usually send an explicit `providerConfigId`.
Coming-soon and disabled vaults are rejected with a 422; a vault that does not
match the secret's provider is rejected the same way.

```json
POST /api/squads/{squadId}/secrets
{
  "name": "prod-stripe-key",
  "provider": "aws_secrets_manager",
  "providerConfigId": "<vault-uuid>",
  "managedMode": "external_reference",
  "externalRef": "arn:aws:secretsmanager:us-east-1:123456789012:secret:slaw/prod/stripe"
}
```

### Response Redaction Rules

Every route in this surface enforces the same redaction contract:

- Secret values are never returned. The board UI never has a "reveal value"
  affordance; resolution happens server-side at runtime under a binding.
- Provider credential values are never accepted, stored, returned, logged, or
  echoed in error messages. Submitting credential-shaped fields fails
  validation with a non-leaking error.
- Activity log entries record vault id, provider, displayName, status, and
  isDefault transitions — never `config` payloads or health detail bodies.

## Remote Import From AWS Secrets Manager

Remote import links existing AWS Secrets Manager entries into Slaw as
`external_reference` secrets. Import stores provider reference metadata only; it
does not copy the remote secret plaintext into Slaw.

The routes are board-only and squad-scoped. `providerConfigId` must point to
a same-squad AWS provider vault with status `ready` or `warning`. Disabled,
coming-soon, non-AWS, and cross-squad vaults are rejected. Imported secrets
resolve later through the selected vault, so runtime reads still need
`secretsmanager:GetSecretValue` and any required KMS decrypt permission on the
selected external secret.

### Preview Remote Import Candidates

```
POST /api/squads/{squadId}/secrets/remote-import/preview
{
  "providerConfigId": "<aws-vault-uuid>",
  "query": "stripe",
  "nextToken": "opaque-provider-token",
  "pageSize": 50
}
```

`query` is optional and is passed to AWS Secrets Manager inventory filtering.
Treat it as non-secret metadata because AWS may record list request parameters
in CloudTrail. `nextToken` is an opaque AWS cursor; callers must pass it back
unchanged and must not synthesize offsets. `pageSize` is optional, defaults to
50 in the UI, and is capped at 100.

Preview uses AWS `ListSecrets` only. It must not call `GetSecretValue` or
`BatchGetSecretValue`, must not request `SecretString`, and must not require KMS
decrypt. The response contains sanitized metadata for display and conflict
decisions:

```json
{
  "providerConfigId": "<aws-vault-uuid>",
  "provider": "aws_secrets_manager",
  "nextToken": null,
  "candidates": [
    {
      "externalRef": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/stripe",
      "remoteName": "prod/stripe",
      "name": "prod/stripe",
      "key": "prod-stripe",
      "providerVersionRef": null,
      "providerMetadata": {
        "createdDate": "2026-05-06T00:00:00.000Z",
        "lastChangedDate": "2026-05-06T00:00:00.000Z",
        "hasDescription": true,
        "hasKmsKey": true,
        "tagCount": 3
      },
      "status": "ready",
      "importable": true,
      "conflicts": []
    }
  ]
}
```

Candidate statuses:

- `ready`: the row can be selected for import.
- `duplicate`: a Slaw secret already links the same canonical provider
  reference for the same provider vault.
- `conflict`: the row has a name/key collision or provider guardrail failure.

Conflict types are `exact_reference`, `name`, `key`, and
`provider_guardrail`. AWS refs under Slaw's own managed namespace are
blocked as external references; use the Slaw-managed secret flow for those
resources instead.

### Import Selected Remote References

```
POST /api/squads/{squadId}/secrets/remote-import
{
  "providerConfigId": "<aws-vault-uuid>",
  "secrets": [
    {
      "externalRef": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/stripe",
      "name": "Stripe production key",
      "key": "stripe-production-key",
      "description": "Stripe key used by production checkout",
      "providerVersionRef": null,
      "providerMetadata": {
        "createdDate": "2026-05-06T00:00:00.000Z"
      }
    }
  ]
}
```

The `secrets` array accepts 1-100 rows. Each row may override the suggested
Slaw `name`, `key`, optional Slaw `description`,
`providerVersionRef`, and sanitized `providerMetadata`. Blank descriptions are
stored as `null`; AWS provider descriptions are not copied into Slaw
descriptions. The backend re-checks duplicate refs and name/key conflicts at
submit time; a stale preview does not bypass those checks.

The import response is row-level:

```json
{
  "providerConfigId": "<aws-vault-uuid>",
  "provider": "aws_secrets_manager",
  "importedCount": 1,
  "skippedCount": 1,
  "errorCount": 0,
  "results": [
    {
      "externalRef": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/stripe",
      "name": "Stripe production key",
      "key": "stripe-production-key",
      "status": "imported",
      "reason": null,
      "secretId": "<slaw-secret-id>",
      "conflicts": []
    }
  ]
}
```

Row statuses:

- `imported`: Slaw created an active `external_reference` secret and one
  metadata-only version row.
- `skipped`: the row had an exact-reference duplicate or name/key conflict.
- `error`: the provider rejected the reference or the row failed validation.

Activity logs for preview/import store aggregate counts, provider id, and vault
id only. They must not store remote secret names, ARNs, descriptions, tags,
plaintext values, provider credentials, or raw AWS error blobs.

## Rotate Secret

```
POST /api/secrets/{secretId}/rotate
{
  "value": "sk-ant-new-value..."
}
```

Creates a new version of the secret. Agents referencing `"version": "latest"`
automatically get the new value on next heartbeat. Pin to a specific version
when a bad `latest` rollout would affect many agents at once.

## Using Secrets in Agent Config

Reference secrets in agent adapter config instead of inline values:

```json
{
  "env": {
    "ANTHROPIC_API_KEY": {
      "type": "secret_ref",
      "secretId": "{secretId}",
      "version": "latest"
    }
  }
}
```

The server resolves and decrypts secret references at runtime, injecting the
real value into the agent process environment. Slaw's custody guarantees
end at injection: the agent process can read, log, or forward the value, so
treat any secret bound to an agent as exposed to that agent. See the custody
boundaries note in the [secrets deploy guide](/deploy/secrets#custody-boundaries).

## Portability

Squad export/import APIs represent agent and project environment requirements
as declarations in the package manifest. Exports omit secret values, secret IDs,
provider references, and encrypted provider material. Use:

```sh
pnpm slaw secrets declarations --squad-id {squadId}
```

to inspect the declarations that an export would emit before moving a package.
