/**
 * Seed script — populates Weaviate with demo data so the UI has something to browse.
 * Run: node src/tests/seed.mjs
 * Reset: node src/tests/seed.mjs --reset
 */

const BASE = 'http://localhost:8080'
const RESET = process.argv.includes('--reset')

async function weaviate(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok && res.status !== 422 && res.status !== 404) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  }
  return text ? JSON.parse(text) : undefined
}

// ── Collections to create ─────────────────────────────────────────────────────

const COLLECTIONS = [
  {
    class: 'TechArticles',
    description: 'Technology news and blog posts',
    vectorizer: 'none',
    properties: [
      { name: 'title',   dataType: ['text'] },
      { name: 'content', dataType: ['text'] },
      { name: 'author',  dataType: ['text'] },
      { name: 'tags',    dataType: ['text[]'] },
      { name: 'url',     dataType: ['text'] },
    ],
  },
  {
    class: 'ProductDocs',
    description: 'Product documentation and FAQs',
    vectorizer: 'none',
    properties: [
      { name: 'title',    dataType: ['text'] },
      { name: 'content',  dataType: ['text'] },
      { name: 'section',  dataType: ['text'] },
      { name: 'product',  dataType: ['text'] },
      { name: 'version',  dataType: ['text'] },
    ],
  },
  {
    class: 'CustomerFeedback',
    description: 'Customer reviews and support tickets',
    vectorizer: 'none',
    properties: [
      { name: 'text',      dataType: ['text'] },
      { name: 'sentiment', dataType: ['text'] },
      { name: 'category',  dataType: ['text'] },
      { name: 'rating',    dataType: ['int'] },
    ],
  },
]

// ── Seed data ─────────────────────────────────────────────────────────────────

const TECH_ARTICLES = [
  {
    title: 'Introduction to Vector Databases',
    content: 'Vector databases are purpose-built to store and query high-dimensional vector embeddings. Unlike traditional relational databases that store structured data in tables, vector databases excel at similarity search — finding items that are semantically "close" to a query. They power modern AI applications including recommendation engines, semantic search, and retrieval-augmented generation (RAG) pipelines.',
    author: 'Alice Chen',
    tags: ['vector-db', 'AI', 'embeddings'],
    url: 'https://example.com/intro-vector-databases',
  },
  {
    title: 'Understanding Transformer Embeddings',
    content: 'Transformer models like BERT and GPT produce contextual embeddings — dense numerical representations of text that capture semantic meaning. A sentence is mapped to a point in high-dimensional space (typically 384–1536 dimensions) such that semantically similar sentences cluster together. This geometric property is what makes vector similarity search so powerful for natural language tasks.',
    author: 'Bob Martinez',
    tags: ['transformers', 'NLP', 'embeddings', 'BERT'],
    url: 'https://example.com/transformer-embeddings',
  },
  {
    title: 'RAG: Retrieval-Augmented Generation Explained',
    content: 'RAG combines the parametric knowledge of large language models with dynamic retrieval from external document stores. When a user poses a question, the system first retrieves the most relevant document chunks via vector similarity search, then passes those chunks as context to the LLM for answer generation. This approach dramatically reduces hallucinations and keeps responses grounded in source material.',
    author: 'Priya Sharma',
    tags: ['RAG', 'LLM', 'retrieval', 'AI'],
    url: 'https://example.com/rag-explained',
  },
  {
    title: 'Weaviate Schema Design Best Practices',
    content: 'A well-designed Weaviate schema starts with clear class boundaries — each class should represent a distinct entity type. Choose your distance metric based on your embedding model: cosine for most text models, dot product for inner-product trained models like OpenAI. Tokenization strategy matters for BM25 keyword search: use "word" for English prose, "field" for short identifiers and IDs.',
    author: 'Alice Chen',
    tags: ['weaviate', 'schema', 'best-practices'],
    url: 'https://example.com/weaviate-schema-design',
  },
  {
    title: 'Hybrid Search: Combining BM25 and Vector Search',
    content: 'Pure vector search excels at semantic understanding but can miss exact keyword matches. BM25 finds exact keyword matches but lacks semantic awareness. Hybrid search fuses both signals using Reciprocal Rank Fusion (RRF) or a weighted alpha parameter. Setting alpha=0 gives pure BM25, alpha=1 gives pure vector search, and values in between blend both approaches for optimal precision and recall.',
    author: 'Carlos Wong',
    tags: ['hybrid-search', 'BM25', 'vector-search', 'weaviate'],
    url: 'https://example.com/hybrid-search',
  },
  {
    title: 'Chunking Strategies for Document Ingestion',
    content: 'Effective chunking is critical for RAG quality. Fixed-size chunking is simple but may split mid-sentence. Sentence-boundary chunking preserves grammatical units. Paragraph-based chunking works well for prose with clear structure. Heading-based chunking maps well to documentation. Overlap between chunks (typically 10–20% of chunk size) prevents important context from being split across boundaries.',
    author: 'Priya Sharma',
    tags: ['chunking', 'ingestion', 'RAG', 'document-processing'],
    url: 'https://example.com/chunking-strategies',
  },
]

const PRODUCT_DOCS = [
  {
    title: 'Getting Started with Vector Admin UI',
    content: 'Vector Admin UI is a browser-based tool for managing Weaviate vector database instances. Connect to any Weaviate server by entering the host, port, and optional API key on the Connect page. Once connected, you can browse collections, inspect objects, run semantic and keyword searches, ingest documents, and test RAG pipelines — all from a single interface.',
    section: 'Getting Started',
    product: 'Vector Admin UI',
    version: '0.1.0',
  },
  {
    title: 'Creating Collections',
    content: 'Navigate to the Collections page and click "New Collection". Enter a class name (PascalCase recommended), optional description, distance metric (cosine for most embedding models), and add properties with their data types. Vector Admin UI supports text, text[], int, number, boolean, and date types. Properties can be marked as searchable (for BM25) and filterable (for where clauses).',
    section: 'Collections',
    product: 'Vector Admin UI',
    version: '0.1.0',
  },
  {
    title: 'Ingesting Documents',
    content: 'The Ingest page supports drag-and-drop upload of TXT, MD, PDF, DOCX, and JSON files. Text is extracted, split into chunks using your chosen strategy (paragraph, sentence, fixed, or heading), and then embedded using your configured embedding provider. Supported providers: Ollama (local), OpenAI, Cohere, and any OpenAI-compatible endpoint. Chunks are batch-upserted to Weaviate.',
    section: 'Ingestion',
    product: 'Vector Admin UI',
    version: '0.1.0',
  },
  {
    title: 'Running Searches',
    content: 'The Search page supports three modes: Semantic search uses vector similarity (nearText or nearVector), BM25 performs keyword matching with term frequency weighting, and Hybrid blends both with a configurable alpha parameter. Results show score, certainty, and distance badges. Expand any result to see all properties and the explainScore field for hybrid queries.',
    section: 'Search',
    product: 'Vector Admin UI',
    version: '0.1.0',
  },
  {
    title: 'RAG Playground',
    content: 'The RAG Playground lets you test full retrieval-augmented generation pipelines. Configure your embedding model (for document retrieval), LLM provider and model (for answer generation), search type, and top-K. Type a question and press Ctrl+Enter. The playground streams the LLM response token-by-token, and the Sources and Context tabs show exactly what was retrieved and passed to the model.',
    section: 'RAG',
    product: 'Vector Admin UI',
    version: '0.1.0',
  },
]

const CUSTOMER_FEEDBACK = [
  { text: 'The semantic search is incredibly fast and accurate. Found exactly what I was looking for even with a vague query.', sentiment: 'positive', category: 'search', rating: 5 },
  { text: 'Ingestion pipeline is smooth. Dropped in a 200-page PDF and it chunked and embedded everything in under a minute.', sentiment: 'positive', category: 'ingestion', rating: 5 },
  { text: 'Would love to see pgvector support. Our team is already on Postgres and adding another database is friction.', sentiment: 'neutral', category: 'feature-request', rating: 3 },
  { text: 'The RAG playground is a game changer for prototyping. Being able to swap embedding models without code changes saves hours.', sentiment: 'positive', category: 'rag', rating: 5 },
  { text: 'Collection creation is straightforward but I wish I could bulk-import a JSON schema definition instead of clicking through each property.', sentiment: 'neutral', category: 'collections', rating: 3 },
  { text: 'Hybrid search alpha slider is a nice touch. Makes it easy to tune the keyword vs semantic balance for our specific domain.', sentiment: 'positive', category: 'search', rating: 4 },
  { text: 'Getting CORS errors when connecting to a remote Weaviate. Would be great to have a configurable proxy setting.', sentiment: 'negative', category: 'connectivity', rating: 2 },
  { text: 'The BM25 results are way better than I expected. Tokenization handles our technical jargon well.', sentiment: 'positive', category: 'search', rating: 4 },
  { text: 'Object detail panel with vector preview bar chart is a clever idea. Helps me understand what the model is picking up.', sentiment: 'positive', category: 'ui', rating: 5 },
  { text: 'Streaming LLM responses make the RAG playground feel responsive. No waiting for the full answer before reading.', sentiment: 'positive', category: 'rag', rating: 5 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomVector(dims = 384) {
  const v = Array.from({ length: dims }, () => (Math.random() * 2 - 1))
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return v.map((x) => x / norm)
}

function ok(label) { console.log(`  ✓ ${label}`) }
function info(label) { console.log(`\n● ${label}`) }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Health check
  info('Checking Weaviate connection...')
  const res = await fetch(`${BASE}/v1/.well-known/ready`)
  if (!res.ok) throw new Error(`Weaviate not ready — is it running on ${BASE}?`)
  const meta = await weaviate('GET', '/v1/meta')
  ok(`Connected  →  Weaviate ${meta.version}`)

  // 2. Optional reset
  if (RESET) {
    info('Resetting — deleting existing collections...')
    for (const col of COLLECTIONS) {
      await fetch(`${BASE}/v1/schema/${col.class}`, { method: 'DELETE' })
      ok(`Deleted ${col.class}`)
    }
  }

  // 3. Create collections (skip if already exists — 422)
  info('Creating collections...')
  for (const col of COLLECTIONS) {
    const res = await fetch(`${BASE}/v1/schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(col),
    })
    if (res.status === 422) {
      ok(`${col.class}  (already exists, skipping)`)
    } else if (res.ok) {
      ok(`${col.class}  created`)
    } else {
      const t = await res.text()
      throw new Error(`Failed to create ${col.class}: ${t}`)
    }
  }

  // 4. Seed TechArticles
  info('Seeding TechArticles...')
  const techBatch = TECH_ARTICLES.map((a) => ({
    class: 'TechArticles',
    properties: a,
    vector: randomVector(384),
  }))
  await weaviate('POST', '/v1/batch/objects', { objects: techBatch })
  ok(`${techBatch.length} articles inserted`)

  // 5. Seed ProductDocs
  info('Seeding ProductDocs...')
  const docBatch = PRODUCT_DOCS.map((d) => ({
    class: 'ProductDocs',
    properties: d,
    vector: randomVector(384),
  }))
  await weaviate('POST', '/v1/batch/objects', { objects: docBatch })
  ok(`${docBatch.length} docs inserted`)

  // 6. Seed CustomerFeedback
  info('Seeding CustomerFeedback...')
  const feedbackBatch = CUSTOMER_FEEDBACK.map((f) => ({
    class: 'CustomerFeedback',
    properties: f,
    vector: randomVector(384),
  }))
  await weaviate('POST', '/v1/batch/objects', { objects: feedbackBatch })
  ok(`${feedbackBatch.length} feedback items inserted`)

  // 7. Verify counts
  info('Verifying object counts...')
  for (const col of COLLECTIONS) {
    const r = await weaviate('POST', '/v1/graphql', {
      query: `{ Aggregate { ${col.class} { meta { count } } } }`,
    })
    const count = r?.data?.Aggregate?.[col.class]?.[0]?.meta?.count ?? 0
    ok(`${col.class}:  ${count} objects`)
  }

  console.log('\n✔ Seed complete — open http://localhost:5173 and browse your data\n')
}

main().catch((e) => { console.error('\n✖', e.message); process.exit(1) })
