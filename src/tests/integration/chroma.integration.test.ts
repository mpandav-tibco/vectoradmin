/**
 * Integration tests for Chroma via ChromaAdapter.
 * Requires Chroma running at localhost:8000.
 * Start with: docker compose --profile chroma up -d
 * Run with:   npm run test:integration:chroma
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ChromaAdapter } from '@/lib/adapters/chroma'
import type { ConnectionConfig } from '@/types/domain'

const CONFIG: ConnectionConfig = {
  dbType: 'chroma',
  host: 'localhost',
  port: 8000,
  scheme: 'http',
  proxyURL: '',   // direct connection for integration tests
}

const COLLECTION = `test_vecboard_${Date.now()}`
const adapter = new ChromaAdapter(CONFIG)

async function waitForChroma(maxMs = 30_000) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const s = await adapter.checkHealth()
    if (s.ready) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Chroma not ready within timeout')
}

describe('Chroma — live connection', () => {
  it('health check reports ready with version', async () => {
    const status = await adapter.checkHealth()
    expect(status.ready).toBe(true)
    expect(status.version).toBeDefined()
    expect(typeof status.version).toBe('string')
  })
})

describe('Chroma — collection lifecycle', () => {
  beforeAll(async () => {
    await waitForChroma()
    await adapter.createCollection({ name: COLLECTION, distance: 'cosine', description: 'Test collection' })
  })

  afterAll(async () => {
    await adapter.deleteCollection(COLLECTION).catch(() => {})
  })

  it('new collection appears in listCollections()', async () => {
    const cols = await adapter.listCollections()
    expect(cols.some((c) => c.name === COLLECTION)).toBe(true)
  })

  it('listCollections maps distance correctly', async () => {
    const cols = await adapter.listCollections()
    const col = cols.find((c) => c.name === COLLECTION)
    expect(col?.distance).toBe('cosine')
  })

  it('getCollection returns object count', async () => {
    const col = await adapter.getCollection(COLLECTION)
    expect(col.name).toBe(COLLECTION)
    expect(col.objectCount).toBe(0)
    expect(col.description).toBe('Test collection')
  })

  it('fresh collection reports 0 objects', async () => {
    expect(await adapter.getObjectCount(COLLECTION)).toBe(0)
  })
})

describe('Chroma — object CRUD', () => {
  let createdId: string

  beforeAll(async () => {
    await waitForChroma()
    const cols = await adapter.listCollections()
    if (!cols.some((c) => c.name === COLLECTION)) {
      await adapter.createCollection({ name: COLLECTION, distance: 'cosine' })
    }
  })

  afterAll(async () => {
    await adapter.deleteCollection(COLLECTION).catch(() => {})
  })

  it('createObject returns a UUID', async () => {
    createdId = await adapter.createObject(
      COLLECTION,
      { content: 'Chroma integration test document', source: 'vitest', year: 2024 },
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
    expect(found!.properties.content).toBe('Chroma integration test document')
    expect(found!.properties.source).toBe('vitest')
  })

  it('deleteObject removes the document', async () => {
    await adapter.deleteObject(COLLECTION, createdId)
    const { objects } = await adapter.listObjects(COLLECTION, 25, 0)
    expect(objects.some((o) => o.id === createdId)).toBe(false)
  })
})

describe('Chroma — batch insert', () => {
  beforeAll(async () => {
    await waitForChroma()
    const cols = await adapter.listCollections()
    if (!cols.some((c) => c.name === COLLECTION)) {
      await adapter.createCollection({ name: COLLECTION, distance: 'cosine' })
    }
  })

  afterAll(async () => {
    await adapter.deleteCollection(COLLECTION).catch(() => {})
  })

  it('batchInsert inserts all objects and returns correct success count', async () => {
    const objects = [
      { properties: { content: 'Batch A — science document', category: 'science' }, vector: [0.9, 0.1, 0.0, 0.0] },
      { properties: { content: 'Batch B — history document', category: 'history' }, vector: [0.0, 0.9, 0.1, 0.0] },
      { properties: { content: 'Batch C — art document', category: 'art' }, vector: [0.0, 0.0, 0.9, 0.1] },
    ]
    const result = await adapter.batchInsert(COLLECTION, objects)
    expect(result.success).toBe(3)
    expect(result.errors).toHaveLength(0)
    expect(await adapter.getObjectCount(COLLECTION)).toBeGreaterThanOrEqual(3)
  })

  it('batchInsert uses provided IDs', async () => {
    const fixedId = `fixed-${Date.now()}`
    const result = await adapter.batchInsert(COLLECTION, [
      { id: fixedId, properties: { content: 'Fixed ID document' } },
    ])
    expect(result.success).toBe(1)
    const { objects } = await adapter.listObjects(COLLECTION, 100, 0)
    expect(objects.some((o) => o.id === fixedId)).toBe(true)
  })
})

describe('Chroma — search', () => {
  const ITEMS = [
    { content: 'Paris is the capital of France', vector: [1.0, 0.0, 0.0, 0.0] },
    { content: 'London is the capital of England', vector: [0.0, 1.0, 0.0, 0.0] },
    { content: 'Tokyo is the capital of Japan', vector: [0.0, 0.0, 1.0, 0.0] },
    { content: 'Berlin is the capital of Germany', vector: [0.0, 0.0, 0.0, 1.0] },
  ]

  beforeAll(async () => {
    await waitForChroma()
    const cols = await adapter.listCollections()
    if (!cols.some((c) => c.name === COLLECTION)) {
      await adapter.createCollection({ name: COLLECTION, distance: 'cosine' })
    }
    await adapter.batchInsert(COLLECTION, ITEMS.map((i) => ({
      properties: { content: i.content },
      vector: i.vector,
    })))
    await new Promise((r) => setTimeout(r, 200))
  })

  afterAll(async () => {
    await adapter.deleteCollection(COLLECTION).catch(() => {})
  })

  it('vectorSearch returns results ordered by similarity', async () => {
    const results = await adapter.vectorSearch(COLLECTION, [1.0, 0.0, 0.0, 0.0], 4)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].properties.content).toContain('Paris')
    // Score should be close to 1 for exact match
    expect(results[0].score).toBeGreaterThan(0.9)
  })

  it('vectorSearch respects n_results limit', async () => {
    const results = await adapter.vectorSearch(COLLECTION, [1.0, 0.0, 0.0, 0.0], 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('vectorSearch scores are between 0 and 1', async () => {
    const results = await adapter.vectorSearch(COLLECTION, [0.5, 0.5, 0.0, 0.0], 4)
    results.forEach((r) => {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(1)
    })
  })

  it('keywordSearch finds documents by text content', async () => {
    const results = await adapter.keywordSearch(COLLECTION, 'France', 5)
    expect(results.some((r) => (r.properties.content as string).includes('Paris'))).toBe(true)
  })

  it('keywordSearch returns score of 1 for all matches', async () => {
    const results = await adapter.keywordSearch(COLLECTION, 'capital', 5)
    results.forEach((r) => expect(r.score).toBe(1))
  })

  it('hybridSearch with vector delegates to vectorSearch', async () => {
    const results = await adapter.hybridSearch(COLLECTION, 'Tokyo Japan', [0.0, 0.0, 1.0, 0.0], 0.5, 4)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].properties.content).toContain('Tokyo')
  })

  it('hybridSearch without vector falls back to keywordSearch', async () => {
    const results = await adapter.hybridSearch(COLLECTION, 'London England', undefined, 0.5, 5)
    expect(results.some((r) => (r.properties.content as string).includes('London'))).toBe(true)
  })
})
