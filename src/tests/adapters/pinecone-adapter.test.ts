/**
 * Unit tests for PineconeAdapter — all methods tested via mocked fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PineconeAdapter } from '@/lib/adapters/pinecone'
import type { ConnectionConfig } from '@/types/domain'

const mockFetch = vi.fn()

beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

const CONFIG: ConnectionConfig = {
  dbType: 'pinecone',
  host: 'my-index-abc123.svc.aped-1234.pinecone.io',
  port: 443,
  scheme: 'https',
  apiKey: 'test-api-key',
}

function adapter() { return new PineconeAdapter(CONFIG) }

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}
function fail(status: number, message = 'error') {
  return Promise.resolve(new Response(JSON.stringify({ message }), { status }))
}

const BASE_STATS = {
  dimension: 1536,
  index_fullness: 0.1,
  total_vector_count: 200,
  namespaces: {
    docs: { vector_count: 150 },
    archive: { vector_count: 50 },
  },
}

// ── checkHealth ───────────────────────────────────────────────────────────────

describe('PineconeAdapter.checkHealth', () => {
  it('returns ready:true with dimension as version string', async () => {
    mockFetch.mockResolvedValue(ok(BASE_STATS))
    const h = await adapter().checkHealth()
    expect(h.ready).toBe(true)
    expect(h.version).toBe('1536d')
  })

  it('returns ready:false with error message on HTTP failure', async () => {
    mockFetch.mockResolvedValue(fail(401, 'Unauthorized'))
    const h = await adapter().checkHealth()
    expect(h.ready).toBe(false)
    expect(h.error).toContain('Unauthorized')
  })

  it('returns ready:false with error on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const h = await adapter().checkHealth()
    expect(h.ready).toBe(false)
    expect(h.error).toContain('ECONNREFUSED')
  })
})

// ── listCollections ───────────────────────────────────────────────────────────

describe('PineconeAdapter.listCollections', () => {
  it('maps namespaces to collections with counts and dimensions', async () => {
    mockFetch.mockResolvedValue(ok(BASE_STATS))
    const cols = await adapter().listCollections()
    expect(cols).toHaveLength(2)
    const docs = cols.find((c) => c.name === 'docs')
    expect(docs?.objectCount).toBe(150)
    expect(docs?.vectorDimensions).toBe(1536)
  })

  it('returns default namespace collection when no named namespaces', async () => {
    mockFetch.mockResolvedValue(ok({ ...BASE_STATS, namespaces: {} }))
    const cols = await adapter().listCollections()
    expect(cols).toHaveLength(1)
    expect(cols[0].name).toBe('')
    expect(cols[0].objectCount).toBe(200)
    expect(cols[0].description).toBe('Default namespace')
  })

  it('calls POST /describe_index_stats', async () => {
    mockFetch.mockResolvedValue(ok(BASE_STATS))
    await adapter().listCollections()
    expect(mockFetch.mock.calls[0][0]).toContain('/describe_index_stats')
    expect((mockFetch.mock.calls[0][1] as RequestInit).method).toBe('POST')
  })
})

// ── getCollection ─────────────────────────────────────────────────────────────

describe('PineconeAdapter.getCollection', () => {
  it('returns collection with correct count for named namespace', async () => {
    mockFetch.mockResolvedValue(ok(BASE_STATS))
    const col = await adapter().getCollection('docs')
    expect(col.name).toBe('docs')
    expect(col.objectCount).toBe(150)
    expect(col.vectorDimensions).toBe(1536)
  })

  it('returns total_vector_count for default namespace (empty string)', async () => {
    mockFetch.mockResolvedValue(ok(BASE_STATS))
    const col = await adapter().getCollection('')
    expect(col.objectCount).toBe(200)
  })
})

// ── createCollection ──────────────────────────────────────────────────────────

describe('PineconeAdapter.createCollection', () => {
  it('is a no-op (Pinecone namespaces are created implicitly)', async () => {
    // Should resolve without making any fetch calls
    await adapter().createCollection({ name: 'new-ns' })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── deleteCollection ──────────────────────────────────────────────────────────

describe('PineconeAdapter.deleteCollection', () => {
  it('sends POST /vectors/delete with delete_all:true and namespace', async () => {
    mockFetch.mockResolvedValue(ok({}))
    await adapter().deleteCollection('docs')
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/vectors/delete')
    const body = JSON.parse(init.body as string)
    expect(body.delete_all).toBe(true)
    expect(body.namespace).toBe('docs')
  })
})

// ── getObjectCount ────────────────────────────────────────────────────────────

describe('PineconeAdapter.getObjectCount', () => {
  it('returns namespace vector count', async () => {
    mockFetch.mockResolvedValue(ok(BASE_STATS))
    expect(await adapter().getObjectCount('archive')).toBe(50)
  })

  it('returns total_vector_count for default namespace', async () => {
    mockFetch.mockResolvedValue(ok(BASE_STATS))
    expect(await adapter().getObjectCount('')).toBe(200)
  })

  it('returns 0 for unknown namespace', async () => {
    mockFetch.mockResolvedValue(ok(BASE_STATS))
    expect(await adapter().getObjectCount('nonexistent')).toBe(0)
  })
})

// ── listObjects ───────────────────────────────────────────────────────────────

describe('PineconeAdapter.listObjects', () => {
  it('returns objects with vectors and metadata from fetch', async () => {
    mockFetch
      .mockResolvedValueOnce(ok(BASE_STATS))                        // getObjectCount
      .mockResolvedValueOnce(ok({ vectors: [{ id: 'v1' }, { id: 'v2' }] }))   // /vectors/list
      .mockResolvedValueOnce(ok({                                     // /vectors/fetch
        vectors: {
          v1: { id: 'v1', values: [0.1, 0.2], metadata: { content: 'hello' } },
          v2: { id: 'v2', values: [0.3, 0.4], metadata: { content: 'world' } },
        },
      }))
    const result = await adapter().listObjects('docs', 10, 0)
    expect(result.total).toBe(150)
    expect(result.objects).toHaveLength(2)
    expect(result.objects[0].vector).toEqual([0.1, 0.2])
    expect(result.objects[0].properties.content).toBe('hello')
  })

  it('returns empty objects array when /vectors/list fails (pod-based index)', async () => {
    mockFetch
      .mockResolvedValueOnce(ok(BASE_STATS))
      .mockRejectedValueOnce(new Error('not supported'))
    const result = await adapter().listObjects('docs', 10, 0)
    expect(result.objects).toHaveLength(0)
    expect(result.total).toBe(150)
  })
})

// ── createObject ──────────────────────────────────────────────────────────────

describe('PineconeAdapter.createObject', () => {
  it('returns a UUID string', async () => {
    mockFetch.mockResolvedValue(ok({ upsertedCount: 1 }))
    const id = await adapter().createObject('docs', { content: 'text' }, [0.1, 0.2])
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('sends POST /vectors/upsert with metadata and namespace', async () => {
    mockFetch.mockResolvedValue(ok({ upsertedCount: 1 }))
    await adapter().createObject('docs', { content: 'hello' }, [0.5])
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/vectors/upsert')
    const body = JSON.parse(init.body as string)
    expect(body.vectors[0].values).toEqual([0.5])
    expect(body.vectors[0].metadata.content).toBe('hello')
    expect(body.namespace).toBe('docs')
  })
})

// ── deleteObject ──────────────────────────────────────────────────────────────

describe('PineconeAdapter.deleteObject', () => {
  it('sends POST /vectors/delete with id and namespace', async () => {
    mockFetch.mockResolvedValue(ok({}))
    await adapter().deleteObject('docs', 'my-id')
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/vectors/delete')
    const body = JSON.parse(init.body as string)
    expect(body.ids).toContain('my-id')
    expect(body.namespace).toBe('docs')
  })
})

// ── vectorSearch ──────────────────────────────────────────────────────────────

describe('PineconeAdapter.vectorSearch', () => {
  it('returns matches with score and properties', async () => {
    mockFetch.mockResolvedValue(ok({
      matches: [
        { id: 'a', score: 0.98, values: [0.1], metadata: { content: 'top result' } },
        { id: 'b', score: 0.82, metadata: { content: 'second' } },
      ],
    }))
    const results = await adapter().vectorSearch('docs', [0.1, 0.2], 5)
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('a')
    expect(results[0].score).toBe(0.98)
    expect(results[0].properties.content).toBe('top result')
    expect(results[0].vector).toEqual([0.1])
  })

  it('sends POST /query with vector, topK, includeMetadata, namespace', async () => {
    mockFetch.mockResolvedValue(ok({ matches: [] }))
    await adapter().vectorSearch('docs', [1, 2, 3], 10)
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.vector).toEqual([1, 2, 3])
    expect(body.topK).toBe(10)
    expect(body.includeMetadata).toBe(true)
    expect(body.namespace).toBe('docs')
  })

  it('returns empty array on no matches', async () => {
    mockFetch.mockResolvedValue(ok({ matches: [] }))
    expect(await adapter().vectorSearch('docs', [], 5)).toEqual([])
  })
})

// ── keywordSearch ─────────────────────────────────────────────────────────────

describe('PineconeAdapter.keywordSearch', () => {
  it('filters matches by query string in any metadata field', async () => {
    mockFetch.mockResolvedValue(ok({
      matches: [
        { id: '1', score: 0.9, metadata: { content: 'hello world' } },
        { id: '2', score: 0.8, metadata: { content: 'unrelated' } },
        { id: '3', score: 0.7, metadata: { title: 'Hello Again' } },
      ],
    }))
    const results = await adapter().keywordSearch('docs', 'hello', 10)
    expect(results.map((r) => r.id)).toEqual(['1', '3'])
  })

  it('is case-insensitive', async () => {
    mockFetch.mockResolvedValue(ok({
      matches: [{ id: '1', score: 0.9, metadata: { content: 'HELLO WORLD' } }],
    }))
    const results = await adapter().keywordSearch('docs', 'hello', 5)
    expect(results).toHaveLength(1)
  })

  it('limits results to the requested count', async () => {
    const matches = Array.from({ length: 20 }, (_, i) => ({
      id: String(i), score: 0.9, metadata: { content: 'target text' },
    }))
    mockFetch.mockResolvedValue(ok({ matches }))
    const results = await adapter().keywordSearch('docs', 'target', 5)
    expect(results).toHaveLength(5)
  })
})

// ── hybridSearch ──────────────────────────────────────────────────────────────

describe('PineconeAdapter.hybridSearch', () => {
  it('delegates to vectorSearch when vector is provided', async () => {
    mockFetch.mockResolvedValue(ok({ matches: [] }))
    await adapter().hybridSearch('docs', 'query', [0.1, 0.2], 0.5, 5)
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.vector).toEqual([0.1, 0.2])
  })

  it('delegates to keywordSearch when no vector', async () => {
    mockFetch.mockResolvedValue(ok({ matches: [{ id: '1', score: 0.9, metadata: { content: 'match' } }] }))
    const results = await adapter().hybridSearch('docs', 'match', undefined, 0.5, 5)
    expect(results[0].id).toBe('1')
  })
})

// ── batchInsert ───────────────────────────────────────────────────────────────

describe('PineconeAdapter.batchInsert', () => {
  it('returns success count equal to number of objects', async () => {
    mockFetch.mockResolvedValue(ok({ upsertedCount: 2 }))
    const result = await adapter().batchInsert('docs', [
      { properties: { content: 'A' }, vector: [0.1] },
      { properties: { content: 'B' }, vector: [0.2] },
    ])
    expect(result.success).toBe(2)
    expect(result.errors).toHaveLength(0)
  })

  it('sends batches of ≤100 vectors', async () => {
    mockFetch.mockResolvedValue(ok({ upsertedCount: 100 }))
    const objects = Array.from({ length: 150 }, (_, i) => ({
      properties: { content: String(i) }, vector: [i * 0.001],
    }))
    await adapter().batchInsert('docs', objects)
    // Should have made 2 fetch calls (100 + 50)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('preserves provided ids', async () => {
    mockFetch.mockResolvedValue(ok({ upsertedCount: 1 }))
    const existingId = 'preset-id-123'
    await adapter().batchInsert('docs', [{ id: existingId, properties: {}, vector: [0.1] }])
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.vectors[0].id).toBe(existingId)
  })

  it('returns error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))
    const result = await adapter().batchInsert('docs', [{ properties: {} }])
    expect(result.success).toBe(0)
    expect(result.errors[0]).toContain('Network error')
  })
})

// ── auth ──────────────────────────────────────────────────────────────────────

describe('PineconeAdapter auth', () => {
  it('sends Api-Key header on every request', async () => {
    mockFetch.mockResolvedValue(ok(BASE_STATS))
    await adapter().checkHealth()
    const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['Api-Key']).toBe('test-api-key')
  })
})
