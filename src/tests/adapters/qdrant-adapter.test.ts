/**
 * Unit tests for QdrantAdapter — all methods tested via mocked fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QdrantAdapter } from '@/lib/adapters/qdrant'
import type { ConnectionConfig } from '@/types/domain'

const mockFetch = vi.fn()

beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

const CONFIG: ConnectionConfig = {
  dbType: 'qdrant', host: 'localhost', port: 6333, scheme: 'http',
  proxyURL: '/api/qdrant',
}

function adapter() { return new QdrantAdapter(CONFIG) }

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}
function fail(status: number, error = 'error') {
  return Promise.resolve(new Response(JSON.stringify({ status: { error } }), { status }))
}

const COLLECTION_INFO = {
  result: {
    points_count: 100,
    config: { params: { vectors: { size: 384, distance: 'Cosine' } } },
  },
}

const POINT = (id: string | number, content = 'text') => ({
  id,
  payload: { content },
  vector: [0.1, 0.2, 0.3],
})

// ── checkHealth ───────────────────────────────────────────────────────────────

describe('QdrantAdapter.checkHealth', () => {
  it('returns ready:true with version on success', async () => {
    mockFetch.mockResolvedValue(ok({ title: 'qdrant', version: '1.9.4' }))
    const status = await adapter().checkHealth()
    expect(status.ready).toBe(true)
    expect(status.version).toBe('1.9.4')
  })

  it('returns ready:false with error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const status = await adapter().checkHealth()
    expect(status.ready).toBe(false)
    expect(status.error).toContain('ECONNREFUSED')
  })

  it('returns ready:false on HTTP error response', async () => {
    mockFetch.mockResolvedValue(fail(503))
    const status = await adapter().checkHealth()
    expect(status.ready).toBe(false)
    expect(status.error).toBeDefined()
  })
})

// ── listCollections ───────────────────────────────────────────────────────────

describe('QdrantAdapter.listCollections', () => {
  it('returns list of collection names', async () => {
    mockFetch.mockResolvedValue(ok({
      result: { collections: [{ name: 'docs' }, { name: 'articles' }] },
    }))
    const cols = await adapter().listCollections()
    expect(cols).toHaveLength(2)
    expect(cols[0].name).toBe('docs')
    expect(cols[1].name).toBe('articles')
  })

  it('returns empty array when no collections', async () => {
    mockFetch.mockResolvedValue(ok({ result: { collections: [] } }))
    expect(await adapter().listCollections()).toEqual([])
  })

  it('calls GET /api/qdrant/collections', async () => {
    mockFetch.mockResolvedValue(ok({ result: { collections: [] } }))
    await adapter().listCollections()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/qdrant/collections')
  })
})

// ── getCollection ─────────────────────────────────────────────────────────────

describe('QdrantAdapter.getCollection', () => {
  it('returns normalized collection with dimensions and distance', async () => {
    mockFetch.mockResolvedValue(ok(COLLECTION_INFO))
    const col = await adapter().getCollection('docs')
    expect(col.name).toBe('docs')
    expect(col.vectorDimensions).toBe(384)
    expect(col.distance).toBe('cosine')
    expect(col.objectCount).toBe(100)
  })

  it('handles named-vector config (multi-vector collections)', async () => {
    mockFetch.mockResolvedValue(ok({
      result: {
        points_count: 50,
        config: {
          params: {
            vectors: { my_vec: { size: 768, distance: 'Dot' } },
          },
        },
      },
    }))
    const col = await adapter().getCollection('multi')
    expect(col.vectorDimensions).toBe(768)
    expect(col.distance).toBe('dot')
  })

  it('calls GET /api/qdrant/collections/:name', async () => {
    mockFetch.mockResolvedValue(ok(COLLECTION_INFO))
    await adapter().getCollection('docs')
    expect(mockFetch.mock.calls[0][0]).toBe('/api/qdrant/collections/docs')
  })
})

// ── createCollection ──────────────────────────────────────────────────────────

describe('QdrantAdapter.createCollection', () => {
  it('sends PUT /collections/:name with vector config', async () => {
    mockFetch.mockResolvedValue(ok({ result: true }))
    await adapter().createCollection({ name: 'newcol', vectorDimensions: 512, distance: 'euclidean' })
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/qdrant/collections/newcol')
    expect((init as RequestInit).method).toBe('PUT')
    const body = JSON.parse(init.body as string)
    expect(body.vectors.size).toBe(512)
    expect(body.vectors.distance).toBe('Euclid')
  })

  it('defaults to 768 dimensions and Cosine distance', async () => {
    mockFetch.mockResolvedValue(ok({ result: true }))
    await adapter().createCollection({ name: 'default' })
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.vectors.size).toBe(768)
    expect(body.vectors.distance).toBe('Cosine')
  })

  it('maps "dot" → "Dot"', async () => {
    mockFetch.mockResolvedValue(ok({ result: true }))
    await adapter().createCollection({ name: 'dot-col', distance: 'dot' })
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.vectors.distance).toBe('Dot')
  })
})

// ── deleteCollection ──────────────────────────────────────────────────────────

describe('QdrantAdapter.deleteCollection', () => {
  it('sends DELETE /collections/:name', async () => {
    mockFetch.mockResolvedValue(ok({ result: true }))
    await adapter().deleteCollection('docs')
    expect(mockFetch.mock.calls[0][0]).toBe('/api/qdrant/collections/docs')
    expect((mockFetch.mock.calls[0][1] as RequestInit).method).toBe('DELETE')
  })
})

// ── getObjectCount ────────────────────────────────────────────────────────────

describe('QdrantAdapter.getObjectCount', () => {
  it('returns count from POST /points/count', async () => {
    mockFetch.mockResolvedValue(ok({ result: { count: 77 } }))
    expect(await adapter().getObjectCount('docs')).toBe(77)
  })

  it('sends POST with { exact: true }', async () => {
    mockFetch.mockResolvedValue(ok({ result: { count: 0 } }))
    await adapter().getObjectCount('docs')
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.exact).toBe(true)
  })
})

// ── listObjects ───────────────────────────────────────────────────────────────

describe('QdrantAdapter.listObjects', () => {
  it('returns objects with string IDs and total', async () => {
    // First call: scroll; second call: count
    mockFetch
      .mockResolvedValueOnce(ok({ result: { points: [POINT('uuid-1'), POINT(42)] } }))
      .mockResolvedValueOnce(ok({ result: { count: 2 } }))
    const result = await adapter().listObjects('docs', 10, 0)
    expect(result.objects).toHaveLength(2)
    expect(result.objects[0].id).toBe('uuid-1')
    expect(result.objects[1].id).toBe('42')  // numeric ID coerced to string
    expect(result.total).toBe(2)
  })

  it('includes vector when present', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ result: { points: [POINT('id-1')] } }))
      .mockResolvedValueOnce(ok({ result: { count: 1 } }))
    const result = await adapter().listObjects('docs', 10, 0)
    expect(result.objects[0].vector).toEqual([0.1, 0.2, 0.3])
  })

  it('payload becomes properties', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ result: { points: [{ id: 'x', payload: { content: 'test', tag: 'a' }, vector: null }] } }))
      .mockResolvedValueOnce(ok({ result: { count: 1 } }))
    const result = await adapter().listObjects('docs', 10, 0)
    expect(result.objects[0].properties.content).toBe('test')
    expect(result.objects[0].properties.tag).toBe('a')
    expect(result.objects[0].vector).toBeUndefined()
  })
})

// ── createObject ──────────────────────────────────────────────────────────────

describe('QdrantAdapter.createObject', () => {
  it('returns a UUID string', async () => {
    mockFetch.mockResolvedValue(ok({ result: { status: 'acknowledged' } }))
    const id = await adapter().createObject('docs', { content: 'Hello' }, [0.1, 0.2])
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('sends PUT /collections/:name/points with points array', async () => {
    mockFetch.mockResolvedValue(ok({ result: { status: 'acknowledged' } }))
    await adapter().createObject('docs', { content: 'Text' }, [0.5])
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/qdrant/collections/docs/points')
    expect((init as RequestInit).method).toBe('PUT')
    const body = JSON.parse(init.body as string)
    expect(body.points).toHaveLength(1)
    expect(body.points[0].payload).toEqual({ content: 'Text' })
    expect(body.points[0].vector).toEqual([0.5])
  })
})

// ── deleteObject ──────────────────────────────────────────────────────────────

describe('QdrantAdapter.deleteObject', () => {
  it('sends POST to /points/delete with id in array', async () => {
    mockFetch.mockResolvedValue(ok({ result: { status: 'acknowledged' } }))
    await adapter().deleteObject('docs', 'my-id')
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/collections/docs/points/delete')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.points).toContain('my-id')
  })
})

// ── vectorSearch ──────────────────────────────────────────────────────────────

describe('QdrantAdapter.vectorSearch', () => {
  it('returns results with string IDs and score', async () => {
    mockFetch.mockResolvedValue(ok({
      result: [
        { id: 'abc', score: 0.92, payload: { content: 'best match' } },
        { id: 123, score: 0.75, payload: { content: 'second' } },
      ],
    }))
    const results = await adapter().vectorSearch('docs', [0.1, 0.2], 5)
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('abc')
    expect(results[0].score).toBe(0.92)
    expect(results[0].properties.content).toBe('best match')
    expect(results[1].id).toBe('123')
  })

  it('sends POST /points/search with vector and limit', async () => {
    mockFetch.mockResolvedValue(ok({ result: [] }))
    await adapter().vectorSearch('docs', [1, 2, 3], 10)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/collections/docs/points/search')
    const body = JSON.parse(init.body as string)
    expect(body.vector).toEqual([1, 2, 3])
    expect(body.limit).toBe(10)
    expect(body.with_payload).toBe(true)
  })
})

// ── keywordSearch ─────────────────────────────────────────────────────────────

describe('QdrantAdapter.keywordSearch', () => {
  it('returns results from scroll with filter', async () => {
    mockFetch.mockResolvedValue(ok({
      result: { points: [{ id: 'p1', payload: { content: 'matched text' } }] },
    }))
    const results = await adapter().keywordSearch('docs', 'matched', 5)
    expect(results).toHaveLength(1)
    expect(results[0].properties.content).toBe('matched text')
  })

  it('sends filter with should clauses for content/text/title', async () => {
    mockFetch.mockResolvedValue(ok({ result: { points: [] } }))
    await adapter().keywordSearch('docs', 'hello', 5)
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    const keys = body.filter.should.map((c: { key: string }) => c.key)
    expect(keys).toContain('content')
    expect(keys).toContain('text')
    expect(keys).toContain('title')
  })
})

// ── hybridSearch ──────────────────────────────────────────────────────────────

describe('QdrantAdapter.hybridSearch', () => {
  it('delegates to vectorSearch when vector is provided', async () => {
    mockFetch.mockResolvedValue(ok({ result: [] }))
    await adapter().hybridSearch('docs', 'query', [0.1, 0.2], 0.5, 5)
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.vector).toBeDefined()
  })

  it('falls back to keywordSearch when vector is undefined', async () => {
    mockFetch.mockResolvedValue(ok({ result: { points: [] } }))
    await adapter().hybridSearch('docs', 'keyword query', undefined, 0.5, 5)
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.filter).toBeDefined()  // keyword scroll includes filter
  })
})

// ── batchInsert ───────────────────────────────────────────────────────────────

describe('QdrantAdapter.batchInsert', () => {
  it('returns success count equal to number of objects', async () => {
    mockFetch.mockResolvedValue(ok({ result: { status: 'acknowledged' } }))
    const result = await adapter().batchInsert('docs', [
      { properties: { content: 'A' }, vector: [0.1] },
      { properties: { content: 'B' }, vector: [0.2] },
    ])
    expect(result.success).toBe(2)
    expect(result.errors).toHaveLength(0)
  })

  it('sends points with id, vector, payload', async () => {
    mockFetch.mockResolvedValue(ok({ result: { status: 'acknowledged' } }))
    const existingId = '550e8400-e29b-41d4-a716-446655440000'
    await adapter().batchInsert('docs', [
      { id: existingId, properties: { content: 'Doc' }, vector: [0.5, 0.6] },
    ])
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.points[0].id).toBe(existingId)
    expect(body.points[0].vector).toEqual([0.5, 0.6])
    expect(body.points[0].payload.content).toBe('Doc')
  })

  it('returns error when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))
    const result = await adapter().batchInsert('docs', [{ properties: { content: 'X' } }])
    expect(result.success).toBe(0)
    expect(result.errors[0]).toContain('Network error')
  })

  it('includes api-key header when apiKey configured', async () => {
    const authedConfig = { ...CONFIG, apiKey: 'qdrant-secret' }
    const a = new QdrantAdapter(authedConfig)
    mockFetch.mockResolvedValue(ok({ result: { status: 'acknowledged' } }))
    await a.batchInsert('docs', [{ properties: {} }])
    const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['api-key']).toBe('qdrant-secret')
  })
})
