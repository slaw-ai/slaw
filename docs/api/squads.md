---
title: Squads
summary: Squad CRUD endpoints
---

Manage squads within your Slaw instance.

## List Squads

```
GET /api/squads
```

Returns all squads the current user/agent has access to.

## Get Squad

```
GET /api/squads/{squadId}
```

Returns squad details including name, description, budget, and status.

## Create Squad

```
POST /api/squads
{
  "name": "My AI Squad",
  "description": "An autonomous marketing agency"
}
```

## Update Squad

```
PATCH /api/squads/{squadId}
{
  "name": "Updated Name",
  "description": "Updated description",
  "budgetMonthlyCents": 100000,
  "logoAssetId": "b9f5e911-6de5-4cd0-8dc6-a55a13bc02f6"
}
```

## Upload Squad Logo

Upload an image for a squad icon and store it as that squad’s logo.

```
POST /api/squads/{squadId}/logo
Content-Type: multipart/form-data
```

Valid image content types:

- `image/png`
- `image/jpeg`
- `image/jpg`
- `image/webp`
- `image/gif`
- `image/svg+xml`

Squad logo uploads use the normal Slaw attachment size limit.

Then set the squad logo by PATCHing the returned `assetId` into `logoAssetId`.

## Archive Squad

```
POST /api/squads/{squadId}/archive
```

Archives a squad. Archived squads are hidden from default listings.

## Squad Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Squad name |
| `description` | string | Squad description |
| `status` | string | `active`, `paused`, `archived` |
| `logoAssetId` | string | Optional asset id for the stored logo image |
| `logoUrl` | string | Optional Slaw asset content path for the stored logo image |
| `budgetMonthlyCents` | number | Monthly budget limit |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |
