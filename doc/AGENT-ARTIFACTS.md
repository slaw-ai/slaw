# Agent Artifact Upload Workflow

Generated files that a board user or reviewer should inspect must be attached to
the Slaw issue before the agent chooses a final disposition. A local
workspace path is not enough, because cloud users and reviewers often cannot
access the agent's disk.

Use the helper bundled with the Slaw skill from the repo root:

```sh
skills/slaw/scripts/slaw-upload-artifact.sh path/to/output.webm \
  --title "Walkthrough render" \
  --summary "Rendered walkthrough for review"
```

The helper uses the authenticated Slaw API from the current heartbeat
environment:

- `SLAW_API_URL`
- `SLAW_API_KEY`
- `SLAW_COMPANY_ID`
- `SLAW_TASK_ID`
- `SLAW_RUN_ID`

It uploads the file to
`POST /api/companies/{companyId}/issues/{issueId}/attachments` and creates an
artifact work product on `POST /api/issues/{issueId}/work-products` by default.
The command prints issue-safe markdown links for the final task comment.

## Completion Pattern

When a task produces a user-inspectable file:

1. Generate and verify the file locally.
2. Upload it with `skills/slaw/scripts/slaw-upload-artifact.sh`.
3. Keep the artifact work product unless the file is incidental; pass
   `--no-work-product` only for supporting files that should not be promoted.
4. Link the printed attachment URL in the final issue comment.
5. Then set the final issue status.

Final comments should name the uploaded artifact, not just the local filesystem
path. Local paths can be included as diagnostic context, but they cannot be the
only access path.

## Video Examples

Upload an `.mp4` render:

```sh
skills/slaw/scripts/slaw-upload-artifact.sh dist/demo.mp4 \
  --title "Demo video render" \
  --summary "MP4 render for board review"
```

Upload a `.webm` render:

```sh
skills/slaw/scripts/slaw-upload-artifact.sh out/walkthrough.webm \
  --title "Walkthrough video" \
  --summary "WebM walkthrough render"
```

The helper detects `.mp4`, `.webm`, and `.mov` content types. If a renderer uses
an unusual extension, pass the MIME type explicitly:

```sh
skills/slaw/scripts/slaw-upload-artifact.sh render.bin \
  --title "Demo video render" \
  --content-type video/mp4
```

## Direct API Pattern

If the helper is unavailable, use the same API shape:

```sh
curl -sS -X POST \
  "$SLAW_API_URL/api/companies/$SLAW_COMPANY_ID/issues/$SLAW_TASK_ID/attachments" \
  -H "Authorization: Bearer $SLAW_API_KEY" \
  -H "X-Slaw-Run-Id: $SLAW_RUN_ID" \
  -F 'file=@"dist/demo.mp4";type=video/mp4'
```

Then create a work product when the uploaded file is the deliverable:

```sh
curl -sS -X POST \
  "$SLAW_API_URL/api/issues/$SLAW_TASK_ID/work-products" \
  -H "Authorization: Bearer $SLAW_API_KEY" \
  -H "X-Slaw-Run-Id: $SLAW_RUN_ID" \
  -H "Content-Type: application/json" \
  --data-binary @artifact-work-product.json
```

Use `type: "artifact"`, `provider: "slaw"`, and metadata containing the
uploaded `attachmentId`. The server canonicalizes `contentType`, `byteSize`,
`contentPath`, `openPath`, `downloadPath`, and `originalFilename`.
