---
title: Docker
summary: Docker Compose quickstart
---

Run Slaw in Docker without installing Node or pnpm locally.

## Compose Quickstart (Recommended)

```sh
docker compose -f docker/docker-compose.quickstart.yml up --build
```

Open [http://localhost:3100](http://localhost:3100).

Defaults:

- Host port: `3100`
- Data directory: `./data/docker-slaw`

Override with environment variables:

```sh
SLAW_PORT=3200 SLAW_DATA_DIR=../data/pc \
  docker compose -f docker/docker-compose.quickstart.yml up --build
```

**Note:** `SLAW_DATA_DIR` is resolved relative to the compose file (`docker/`), so `../data/pc` maps to `data/pc` in the project root.

## Manual Docker Build

```sh
docker build -t slaw-local .
docker run --name slaw \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e SLAW_HOME=/slaw \
  -v "$(pwd)/data/docker-slaw:/slaw" \
  slaw-local
```

## Data Persistence

All data is persisted under the bind mount (`./data/docker-slaw`):

- Embedded PostgreSQL data
- Uploaded assets
- Local secrets key
- Agent workspace data

## Claude and Codex Adapters in Docker

The Docker image pre-installs:

- `claude` (Anthropic Claude Code CLI)
- `codex` (OpenAI Codex CLI)

Pass API keys to enable local adapter runs inside the container:

```sh
docker run --name slaw \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e SLAW_HOME=/slaw \
  -e OPENAI_API_KEY=sk-... \
  -e ANTHROPIC_API_KEY=sk-... \
  -v "$(pwd)/data/docker-slaw:/slaw" \
  slaw-local
```

Without API keys, the app runs normally — adapter environment checks will surface missing prerequisites.
