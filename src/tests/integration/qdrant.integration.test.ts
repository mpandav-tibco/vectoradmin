/**
 * Integration tests for Qdrant via QdrantAdapter.
 * Requires Qdrant running at localhost:6333.
 * Start with: docker compose --profile qdrant up -d
 * Run with:   npm run test:integration:qdrant
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { QdrantAdapter } from '@/lib/adapters/qdrant'
import type { ConnectionConfig } from '@/types/domain'

const CONFIG: ConnectionConfig = {
  dbType: 'qdrant',
  host: 'localhost',
  port: 6333,
  scheme: 'http',
  proxyURL: '',   // direct connection for integration tests
}

const COLLECTION = `test_vecboard_${Date.now()}`
const DIMS = 4
const adapter = new QdrantAdapter(CONFIG)

// Wait until Qdrant is ready (up to 30 s)
async function waitForQdrant(maxMs = 30_000) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const s = await adapter.checkHealth()
    if (s.ready) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Qdrant not ready within timeout')
}

describe('Qdrant — live connection', () => {
  it('health check reports ready', async () => {
    const status = await adapter.checkHealth()
    expect(status.ready).toBe(true)
    expect(status.version).toMatch(/^\d+\.\d+/)
  })
})

describe('Qdrant — collection lifecycle', () => {
  beforeAll(async () => {
    await waitForQdrant()
    await adapter.createCollection({ name: COLLECTION, vectorDimensions: DIMS, distance: 'cosine' })
  })

  afterAll(async () => {
    await adapter.deleteCollection(COLLECTION).catch(() => {})
  })

  it('new collection appears in listCollections()', async () => {
    const cols = await adapter.listCollections()
    expect(cols.some((c) => c.name === COLLECTION)).toBe(true)
  })

  it('getCollection returns correct dimensions and distance', async () => {
    const col = await adapter.getCollection(COLLECTION)
    expect(col.name).toBe(COLLECTION)
    expect(col.vectorDimensions).toBe(DIMS)
    expect(col.distance).toBe('cosine')
  })

  it('fresh collection has 0 objects', async () => {
    expect(await adapter.getObjectCount(COLLECTION)).toBe(0)
  })
})

describe('Qdrant — object CRUD', () => {
  let createdId: string

  beforeAll(async () => {
    await waitForQdrant()
    // Ensure collection exists
    const cols = await adapter.listCollections()
    if (!cols.some((c) => c.name === COLLECTION)) {
      await adapter.createCollection({ name: COLLECTION, vectorDimensions: DIMS, distance: 'cosine' })
    }
  })

  afterAll(async () => {
    await adapter.deleteCollection(COLLECTION).catch(() => {})
  })

  it('createObject returns a UUID', async () => {
    createdId = await adapter.createObject(
      COLLECTION,
      { content: 'Hello from integration test', source: 'vitest' },
      [0.1, 0.2, 0.3, 0.4]
    )
    expect(typeof createdId).toBe('string')
    expect(createdId.length).toBeGreaterThan(0)
  })

  it('object count increases after insert', async () => {
    const count = await adapter.getObjectCount(COLLECTION)
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('listObjects includes the created object', async () => {
    const { objects } = await adapter.listObjects(COLLECTION, 25, 0)
    const found = objects.find((o) => o.id === createdId)
    expect(found).toBeDefined()
    expect(found!.properties.content).toBe('Hello from integration test')
    expect(found!.properties.source).toBe('vitest')
    // Qdrant normalizes vectors to unit length for cosine collections; check dimension only
    expect(Array.isArray(found!.vector)).toBe(true)
    expect(found!.vector!.length).toBe(DIMS)
  })

  it('deleteObject removes the point', async () => {
    await adapter.deleteObject(COLLECTION, createdId)
    const { objects } = await adapter.listObjects(COLLECTION, 25, 0)
    expect(objects.some((o) => o.id === createdId)).toBe(false)
  })
})

describe('Qdrant — batch insert', () => {
  beforeAll(async () => {
    await waitForQdrant()
    const cols = await adapter.listCollections()
    if (!cols.some((c) => c.name === COLLECTION)) {
      await adapter.createCollection({ name: COLLECTION, vectorDimensions: DIMS, distance: 'cosine' })
    }
  })

  afterAll(async () => {
    await adapter.deleteCollection(COLLECTION).catch(() => {})
  })

  it('batchInsert inserts all objects and returns success count', async () => {
    const objects = [
      { properties: { content: 'Batch item one', tag: 'batch' }, vector: [0.9, 0.1, 0.0, 0.0] },
      { properties: { content: 'Batch item two', tag: 'batch' }, vector: [0.0, 0.9, 0.1, 0.0] },
      { properties: { content: 'Batch item three', tag: 'batch' }, vector: [0.0, 0.0, 0.9, 0.1] },
    ]
    const result = await adapter.batchInsert(COLLECTION, objects)
    expect(result.success).toBe(3)
    expect(result.errors).toHaveLength(0)
    expect(await adapter.getObjectCount(COLLECTION)).toBeGreaterThanOrEqual(3)
  })
})

describe('Qdrant — search', () => {
  const ITEMS = [
    { content: 'Paris is the capital of France', vector: [1.0, 0.0, 0.0, 0.0] },
    { content: 'London is the capital of England', vector: [0.0, 1.0, 0.0, 0.0] },
    { content: 'Tokyo is the capital of Japan', vector: [0.0, 0.0, 1.0, 0.0] },
    { content: 'Berlin is the capital of Germany', vector: [0.0, 0.0, 0.0, 1.0] },
  ]

  beforeAll(async () => {
    await waitForQdrant()
    // Create fresh collection for search tests
    const cols = await adapter.listCollections()
    if (!cols.some((c) => c.name === COLLECTION)) {
      await adapter.createCollection({ name: COLLECTION, vectorDimensions: DIMS, distance: 'cosine' })
    }
    await adapter.batchInsert(COLLECTION, ITEMS.map((i) => ({ properties: { content: i.content }, vector: i.vector })))
    // Allow Qdrant to index
    await new Promise((r) => setTimeout(r, 300))
  })

  afterAll(async () => {
    await adapter.deleteCollection(COLLECTION).catch(() => {})
  })

  it('vectorSearch returns nearest vector and correct score order', async () => {
    const results = await adapter.vectorSearch(COLLECTION, [1.0, 0.0, 0.0, 0.0], 4)
    expect(results.length).toBeGreaterThan(0)
    // First result should be Paris (exact match with query vector)
    expect(results[0].properties.content).toContain('Paris')
    expect(results[0].score).toBeGreaterThan(0.9)
  })

  it('vectorSearch respects topK limit', async () => {
    const results = await adapter.vectorSearch(COLLECTION, [1.0, 0.0, 0.0, 0.0], 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('keywordSearch finds documents by single-word content match', async () => {
    // Qdrant match.text requires a text index for multi-word queries;
    // single words work via payload filter on any indexed or stored field.
    const results = await adapter.keywordSearch(COLLECTION, 'France', 5)
    expect(results.some((r) => (r.properties.content as string).includes('Paris'))).toBe(true)
  })

  it('hybridSearch with vector returns ranked results', async () => {
    const results = await adapter.hybridSearch(COLLECTION, 'Tokyo', [0.0, 0.0, 1.0, 0.0], 0.5, 4)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].properties.content).toContain('Tokyo')
  })

  it('hybridSearch without vector falls back to keyword (single-word query)', async () => {
    // Without a vector, hybridSearch delegates to keywordSearch.
    // Use a single word that appears in the payload to avoid needing a full-text index.
    const results = await adapter.hybridSearch(COLLECTION, 'London', undefined, 0.5, 5)
    expect(results.some((r) => (r.properties.content as string).includes('London'))).toBe(true)
  })
})
