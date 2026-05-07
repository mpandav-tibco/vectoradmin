# Vector Admin UI

A browser-based admin UI for vector databases. Connect to Weaviate, Qdrant, Chroma, Pinecone, or pgvector — then browse collections, ingest documents, run search, and experiment with RAG, all from one interface.

![dark mode UI](https://placehold.co/900x400?text=Vector+Admin+UI)

## Supported Databases

| Database | Collections | Objects | Search | Ingest | Transfer |
|---|---|---|---|---|---|
| Weaviate | ✓ | ✓ | ✓ (server-side filters) | ✓ | ✓ |
| Qdrant | ✓ | ✓ | ✓ | ✓ | ✓ |
| Chroma | ✓ | ✓ | ✓ | ✓ | ✓ |
| Pinecone | ✓ (namespaces) | ✓ | ✓ | ✓ | ✓ |
| pgvector | ✓ (PostgREST) | ✓ | ✓ | ✓ | ✓ |

## Quick Start

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose.

```bash
git clone <repo-url>
cd vector-admin-ui
docker compose up -d --build
```

Open **http://localhost:3000**. The Connect page appears — Weaviate defaults are pre-filled.

> First build downloads ~200 MB of images. Subsequent starts are instant.

### Optional databases

```bash
# Start with Qdrant
docker compose --profile qdrant up -d

# Start with Chroma
docker compose --profile chroma up -d

# Start with Ollama (for local embeddings and RAG)
docker compose --profile ollama up -d

# Pull Ollama models (one-time, ~2–5 GB)
docker exec ollama-dev ollama pull nomic-embed-text
docker exec ollama-dev ollama pull llama3.2:3b
```

Data is stored in named Docker volumes (`weaviate_data`, `qdrant_data`, `chroma_data`, `ollama_data`) and survives container restarts.

## Features

### Connections
- Save multiple connections with labels; switch between them with one click
- Per-connection embedding provider config — auto-loaded when you switch
- Test connection health before activating (8-second timeout)
- Export / import connections as JSON for team sharing
- Credentials stored in browser localStorage (avoid shared machines for sensitive keys)

### Collections
- Create, browse, and delete collections with full schema inspection
- Object counts, vector dimensions, distance metric, and property types shown per collection
- Bulk-delete objects with preview

### Objects
- Paginated object viewer with inline vector display
- Add individual objects with optional vector
- Delete objects by ID

### Search
- **Keyword** (BM25 / full-text), **Semantic** (nearest-vector), and **Hybrid** search
- Adjustable alpha and top-K
- Property filters — executed server-side on Weaviate, client-side on other databases
- Results linked to 3D vector visualization for spatial exploration
- Search analytics log (session-only, not persisted)

### Ingest
- Drag-and-drop PDF, TXT, and DOCX files
- Chunking strategies: fixed size, sentence, paragraph, heading
- Configurable chunk size and overlap
- Embedding provider selector (Ollama · OpenAI · Cohere · custom endpoint)
- Per-job progress tracking with retry support

### RAG Playground
- Ask natural-language questions over your collections
- Configurable retrieval (search type, top-K) and LLM (Ollama · OpenAI · custom)
- Full conversation history with sources shown per answer
- Export history to JSON or Markdown
- Vectors stripped from persisted history to keep localStorage lean

### Transfer
- Copy objects (and optionally raw vectors) from one collection to another
- Source and target can be different connections — including different database types
- Cross-database type warning when source and target DB differ
- Schema comparison table: highlights source-only, target-only, and type-mismatch properties
- Per-property migration actions: skip or rename before transfer
- Auto-creates target collection from source schema when missing
- Detects vector dimensions from a sample when the schema doesn't report them
- Batch size control; progress bar and per-batch log

### Vector Visualization
- PCA-based 3D projection of collection vectors
- Highlight specific object IDs from search results

### UI
- Dark and light mode
- Keyboard-friendly forms

## Development

Requires Node.js 20+.

```bash
# Start only the backend(s) you need
docker compose up -d weaviate

# Install and run
npm install
npm run dev        # http://localhost:5173 — hot reload
```

### Proxy configuration

The dev server proxies `/api/weaviate`, `/api/qdrant`, `/api/chroma`, `/api/pgvector`, and `/api/ollama` to their respective local ports. Override the targets in `.env.local`:

```bash
cp .env.example .env.local
# edit .env.local — change ports if your services run elsewhere
```

`.env.example`:
```
WEAVIATE_URL=http://localhost:8080
QDRANT_URL=http://localhost:6333
CHROMA_URL=http://localhost:8000
PGVECTOR_URL=http://localhost:3000
OLLAMA_URL=http://localhost:11434
```

### Scripts

```bash
npm run typecheck               # TypeScript check
npm run test                    # unit tests (Vitest, no live DB)
npm run test:integration        # integration tests (requires running DBs)
npm run test:integration:weaviate
npm run test:integration:qdrant
npm run test:integration:chroma
npm run seed                    # seed sample data into Weaviate
npm run seed:reset              # wipe and re-seed
```

## Connecting to a Remote Database

On the Connect page, expand **Advanced — proxy settings** and set the Proxy URL to your remote database URL (e.g. `https://my-weaviate.example.com`). All requests are routed through that URL, which avoids browser CORS restrictions.

For Pinecone, enter the index host directly (found in the Pinecone console under **Indexes → your index → Host**) and provide your API key.

## Tech Stack

React 18 · TypeScript · Vite · Tailwind CSS · Zustand · TanStack Query · Docker
