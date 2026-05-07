# Vector Admin UI

A dark-themed web UI for managing [Weaviate](https://weaviate.io) vector databases — browse collections, ingest documents, run hybrid search, and experiment with RAG (Retrieval-Augmented Generation).

## Quick Start

**Requires:** [Docker](https://docs.docker.com/get-docker/) and Docker Compose

```bash
git clone <repo-url>
cd vector-admin-ui
docker compose up -d --build
```

Open **http://localhost:3000** — the Connect page appears. Click **Connect to Weaviate** (defaults are pre-filled).

> First build downloads ~200 MB of images and compiles the app. Subsequent starts are instant.

## What's Inside

| Feature | Description |
|---|---|
| **Collections** | Create, browse, and delete Weaviate collections with full schema control |
| **Objects** | Paginated object viewer, add/delete individual vectors |
| **Search** | BM25 keyword, hybrid (BM25 + vector), and semantic (nearVector) search |
| **Ingest** | Drag-and-drop PDF/TXT/DOCX ingestion with chunking strategies |
| **RAG Playground** | Ask questions over your documents using Ollama or OpenAI |
| **Overview** | Live cluster health, object counts, and version info |

## Services

```
localhost:3000  →  UI (nginx)
                     ├─ /api/weaviate/* → weaviate:8080
                     └─ /api/ollama/*   → ollama:11434  (if running)

localhost:8080  →  Weaviate REST + GraphQL (also exposed directly)
```

Data is persisted in Docker named volumes (`weaviate_data`, `ollama_data`) — survives container restarts.

## Optional: Ollama (local LLM for RAG)

Ollama is not started by default. To enable it:

```bash
# Start everything including Ollama
docker compose --profile ollama up -d

# Pull models (one-time, ~2–5 GB)
docker exec ollama-dev ollama pull nomic-embed-text   # embeddings
docker exec ollama-dev ollama pull llama3.2:3b        # chat / RAG
```

Then open the RAG Playground, select **Ollama** as the provider, and start asking questions.

## Development Mode

Requires Node.js 20+.

```bash
# Start Weaviate (backend only)
docker compose up -d weaviate

# Install deps and run dev server
npm install
npm run dev
```

Dev server runs at **http://localhost:5173** with hot reload. API calls proxy through Vite to avoid CORS.

```bash
npm run typecheck      # TypeScript check
npm run test           # unit tests (Vitest)
npm run test:integration   # live tests against running Weaviate
npm run seed           # seed sample data into Weaviate
```

## Connecting to a Remote Weaviate

On the Connect page, expand **Advanced — proxy settings** and enter your remote Weaviate URL as the Proxy URL (e.g. `https://my-weaviate.example.com`). This routes all requests through that endpoint and avoids browser CORS restrictions.

## Tech Stack

React 18 · TypeScript · Vite · Tailwind CSS · Zustand · TanStack Query · Weaviate · nginx · Docker
