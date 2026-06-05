# Generated Artifacts and Work Products

When work produces a user-inspectable file, upload it to the current issue before final disposition. Local filesystem paths are not enough because board users, reviewers, and cloud operators may not have access to the agent workspace.

Use the helper bundled with this skill. From an installed `slaw` skill directory, the helper lives at `scripts/slaw-upload-artifact.sh`:

```bash
scripts/slaw-upload-artifact.sh path/to/output.webm \
  --title "Walkthrough render" \
  --summary "Rendered walkthrough for review"
```

The helper uses `SLAW_API_URL`, `SLAW_API_KEY`, `SLAW_SQUAD_ID`, `SLAW_TASK_ID`, and `SLAW_RUN_ID`. It uploads the file as an issue attachment, creates an attachment-backed artifact work product by default, and prints issue-safe markdown links for your final comment.

If the helper is unavailable, use the Slaw API directly:

```bash
curl -sS -X POST \
  "$SLAW_API_URL/api/squads/$SLAW_SQUAD_ID/issues/$SLAW_TASK_ID/attachments" \
  -H "Authorization: Bearer $SLAW_API_KEY" \
  -H "X-Slaw-Run-Id: $SLAW_RUN_ID" \
  -F 'file=@"path/to/output.webm";type=video/webm'
```

Then create a work product when the file is the deliverable. The server canonicalizes attachment-backed artifact metadata from the `attachmentId`:

```bash
curl -sS -X POST \
  "$SLAW_API_URL/api/issues/$SLAW_TASK_ID/work-products" \
  -H "Authorization: Bearer $SLAW_API_KEY" \
  -H "X-Slaw-Run-Id: $SLAW_RUN_ID" \
  -H "Content-Type: application/json" \
  --data-binary '{
    "type": "artifact",
    "provider": "slaw",
    "title": "Walkthrough render",
    "status": "ready_for_review",
    "reviewState": "needs_board_review",
    "isPrimary": true,
    "metadata": { "attachmentId": "<uploaded-attachment-id>" }
  }'
```

In your final issue comment, link the uploaded attachment or work product and describe what it contains. Do not leave artifact-producing work `in_progress` with only a local path or a `Remaining` note.
