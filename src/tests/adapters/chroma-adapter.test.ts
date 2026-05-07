/**
 * Unit tests for ChromaAdapter — all methods tested via mocked fetch.
 * Note: Chroma resolves collection UUID from name before most operations,
 * so many tests require 2 mock responses (id-lookup + actual request).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ChromaAdapter } from '@/lib/adapters/chroma'
import type { ConnectionConfig } from '@/types/domain'

const mockFetch = vi.fn()

beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

const CONFIG: ConnectionConfig = {
  dbType: 'chroma', host: 'localhost', port: 8000, scheme: 'http',
  proxyURL: '/api/chroma',
}

function adapter() { return new ChromaAdapter(CONFIG) }

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

const COL_ID = 'a1b2c3d4-0000-0000-0000-000000000001'

const CHROMA_COLLECTION = { id: COL_ID, name: 'docs', metadata: { 'hnsw:space': 'cosine', description: 'My docs' } }

// Helper: first response returns collection id, second returns the actual data
function withId(dataRes: unknown) {
  mockFetch
    .mockResolvedValueOnce(ok(CHROMA_COLLECTION))   // getCollectionId
    .mockResolvedValueOnce(ok(dataRes))
}

// ── checkHealth ───────────────────────────────────────────────────────────────

describe('ChromaAdapter.checkHealth', () => {
  it('returns ready:true with version on success', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({}))                  // GET /api/v1
      .mockResolvedValueOnce(ok('"0.5.0"'))           // GET /api/v1/version
    const status = await adapter().checkHealth()
    expect(status.ready).toBe(true)
    expect(status.version).toBe('0.5.0')
  })

  it('strips surrounding quotes from version string', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok('"0.5.1"'))
    const status = await adapter().checkHealth()
    expect(status.version).toBe('0.5.1')
  })

  it('returns ready:false with error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const status = await adapter().checkHealth()
    expect(status.ready).toBe(false)
    expect(status.error).toContain('ECONNREFUSED')
  })
})

// ── listCollections ───────────────────────────────────────────────────────────

describe('ChromaAdapter.listCollections', () => {
  it('returns normalized collection list with distance', async () => {
    mockFetch.mockResolvedValue(ok([
      { id: 'id-1', name: 'col1', metadata: { 'hnsw:space': 'cosine' } },
      { id: 'id-2', name: 'col2', metadata: { 'hnsw:space': 'l2' } },
    ]))
    const cols = await adapter().listCollections()
    expect(cols).toHaveLength(2)
    expect(cols[0].name).toBe('col1')
    expect(cols[0].distance).toBe('cosine')
    expect(cols[1].distance).toBe('euclidean')
  })

  it('handles ip (dot product) space mapping', async () => {
    mockFetch.mockResolvedValue(ok([{ id: 'x', name: 'ip-col', metadata: { 'hnsw:space': 'ip' } }]))
    const [col] = await adapter().listCollections()
    expect(col.distance).toBe('dot')
  })

  it('returns description from metadata', async () => {
    mockFetch.mockResolvedValue(ok([CHROMA_COLLECTION]))
    const [col] = await adapter().listCollections()
    expect(col.description).toBe('My docs')
  })

  it('calls GET /api/v1/collections', async () => {
    mockFetch.mockResolvedValue(ok([]))
    await adapter().listCollections()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/chroma/api/v1/collections')
  })
})

// ── getCollection ─────────────────────────────────────────────────────────────

describe('ChromaAdapter.getCollection', () => {
  it('returns collection with object count', async () => {
    mockFetch
      .mockResolvedValueOnce(ok(CHROMA_COLLECTION))          // GET /collections/:name
      .mockResolvedValueOnce(ok(42))                          // GET /collections/:id/count
    const col = await adapter().getCollection('docs')
    expect(col.name).toBe('docs')
    expect(col.objectCount).toBe(42)
    expect(col.distance).toBe('cosine')
  })
})

// ── createCollection ──────────────────────────────────────────────────────────

describe('ChromaAdapter.createCollection', () => {
  it('sends POST /api/v1/collections with correct body', async () => {
    mockFetch.mockResolvedValue(ok(CHROMA_COLLECTION))
    await adapter().createCollection({ name: 'newcol', distance: 'cosine', description: 'Test' })
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/chroma/api/v1/collections')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.name).toBe('newcol')
    expect(body.metadata['hnsw:space']).toBe('cosine')
    expect(body.metadata.description).toBe('Test')
    expect(body.get_or_create).toBe(false)
  })

  it('maps "euclidean" → "l2"', async () => {
    mockFetch.mockResolvedValue(ok(CHROMA_COLLECTION))
    await adapter().createCollection({ name: 'l2-col', distance: 'euclidean' })
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.metadata['hnsw:space']).toBe('l2')
  })

  it('maps "dot" → "ip"', async () => {
    mockFetch.mockResolvedValue(ok(CHROMA_COLLECTION))
    await adapter().createCollection({ name: 'ip-col', distance: 'dot' })
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.metadata['hnsw:space']).toBe('ip')
  })
})

// ── deleteCollection ──────────────────────────────────────────────────────────

describe('ChromaAdapter.deleteCollection', () => {
  it('sends DELETE /api/v1/collections/:name', async () => {
    mockFetch.mockResolvedValue(ok({}))
    await adapter().deleteCollection('docs')
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/chroma/api/v1/collections/docs')
    expect((init as RequestInit).method).toBe('DELETE')
  })
})

// ── getObjectCount ────────────────────────────────────────────────────────────

describe('ChromaAdapter.getObjectCount', () => {
  it('returns count via id lookup then count endpoint', async () => {
    withId(25)
    expect(await adapter().getObjectCount('docs')).toBe(25)
    const countUrl = mockFetch.mock.calls[1][0] as string
    expect(countUrl).toContain(`/collections/${COL_ID}/count`)
  })
})

// ── listObjects ───────────────────────────────────────────────────────────────

describe('ChromaAdapter.listObjects', () => {
  it('maps Chroma documents/metadatas/embeddings to DBObject format', async () => {
    mockFetch
      .mockResolvedValueOnce(ok(CHROMA_COLLECTION))   // getCollectionId
      .mockResolvedValueOnce(ok({                      // POST /get
        ids: ['doc-1', 'doc-2'],
        documents: ['Hello', 'World'],
        metadatas: [{ source: 'a' }, { source: 'b' }],
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
      }))
      .mockResolvedValueOnce(ok(2))                    // count
    const result = await adapter().listObjects('docs', 10, 0)
    expect(result.total).toBe(2)
    expect(result.objects).toHaveLength(2)
    expect(result.objects[0].id).toBe('doc-1')
    expect(result.objects[0].properties.content).toBe('Hello')
    expect(result.objects[0].properties.source).toBe('a')
    expect(result.objects[0].vector).toEqual([0.1, 0.2])
  })

  it('sends limit and offset in POST body', async () => {
    mockFetch
      .mockResolvedValueOnce(ok(CHROMA_COLLECTION))
      .mockResolvedValueOnce(ok({ ids: [], documents: [], metadatas: [] }))
      .mockResolvedValueOnce(ok(0))
    await adapter().listObjects('docs', 15, 30)
    const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.limit).toBe(15)
    expect(body.offset).toBe(30)
  })
})

// ── createObject ──────────────────────────────────────────────────────────────

describe('ChromaAdapter.createObject', () => {
  it('returns a new UUID', async () => {
    withId({})
    const id = await adapter().createObject('docs', { content: 'Hello', source: 'web' }, [0.1, 0.2])
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('separates content from metadata and includes embeddings', async () => {
    withId({})
    await adapter().createObject('docs', { content: 'My text', tag: 'test' }, [0.5])
    const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.documents[0]).toBe('My text')
    expect(body.metadatas[0]).toEqual({ tag: 'test' })
    expect(body.embeddings[0]).toEqual([0.5])
  })

  it('uses "text" property as document when "content" is absent', async () => {
    withId({})
    await adapter().createObject('docs', { text: 'Alt text' })
    const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.documents[0]).toBe('Alt text')
  })

  it('does not include embeddings key when no vector provided', async () => {
    withId({})
    await adapter().createObject('docs', { content: 'No vec' })
    const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.embeddings).toBeUndefined()
  })
})

// ── deleteObject ──────────────────────────────────────────────────────────────

describe('ChromaAdapter.deleteObject', () => {
  it('sends POST /collections/:id/delete with id array', async () => {
    withId({})
    await adapter().deleteObject('docs', 'doc-id-1')
    const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(url).toContain(`/collections/${COL_ID}/delete`)
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.ids).toContain('doc-id-1')
  })
})

// ── vectorSearch ──────────────────────────────────────────────────────────────

describe('ChromaAdapter.vectorSearch', () => {
  const QUERY_RESP = {
    ids: [['r1', 'r2']],
    distances: [[0.1, 0.3]],
    documents: [['Best match', 'Second match']],
    metadatas: [[{ tag: 'a' }, { tag: 'b' }]],
  }

  it('returns results with score = 1 - distance', async () => {
    withId(QUERY_RESP)
    const results = await adapter().vectorSearch('docs', [0.1, 0.2], 5)
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('r1')
    expect(results[0].score).toBeCloseTo(0.9)   // 1 - 0.1
    expect(results[1].score).toBeCloseTo(0.7)   // 1 - 0.3
  })

  it('includes document content and metadata in properties', async () => {
    withId(QUERY_RESP)
    const results = await adapter().vectorSearch('docs', [0.1], 2)
    expect(results[0].properties.content).toBe('Best match')
    expect(results[0].properties.tag).toBe('a')
  })

  it('sends query_embeddings in POST body', async () => {
    withId(QUERY_RESP)
    await adapter().vectorSearch('docs', [0.5, 0.6], 3)
    const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.query_embeddings).toEqual([[0.5, 0.6]])
    expect(body.n_results).toBe(3)
  })

  it('clamps score to 0 when distance > 1', async () => {
    withId({ ids: [['x']], distances: [[1.5]], documents: [['text']], metadatas: [[{}]] })
    const results = await adapter().vectorSearch('docs', [], 1)
    expect(results[0].score).toBe(0)
  })
})

// ── keywordSearch ─────────────────────────────────────────────────────────────

describe('ChromaAdapter.keywordSearch', () => {
  it('returns results from where_document query', async () => {
    withId({
      ids: ['kw-1'],
      documents: ['keyword matched text'],
      metadatas: [{}],
    })
    const results = await adapter().keywordSearch('docs', 'keyword', 5)
    expect(results).toHaveLength(1)
    expect(results[0].properties.content).toBe('keyword matched text')
    expect(results[0].score).toBe(1)
  })

  it('sends where_document with $contains operator', async () => {
    withId({ ids: [], documents: [], metadatas: [] })
    await adapter().keywordSearch('docs', 'search term', 5)
    const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.where_document).toEqual({ $contains: 'search term' })
  })
})

// ── hybridSearch ──────────────────────────────────────────────────────────────

describe('ChromaAdapter.hybridSearch', () => {
  it('delegates to vectorSearch when vector is provided', async () => {
    // vectorSearch: id lookup + query
    mockFetch
      .mockResolvedValueOnce(ok(CHROMA_COLLECTION))
      .mockResolvedValueOnce(ok({ ids: [[]], distances: [[]], documents: [[]], metadatas: [[]] }))
    await adapter().hybridSearch('docs', 'q', [0.1, 0.2], 0.5, 5)
    const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.query_embeddings).toBeDefined()
  })

  it('falls back to keywordSearch when vector is undefined', async () => {
    withId({ ids: [], documents: [], metadatas: [] })
    await adapter().hybridSearch('docs', 'keyword', undefined, 0.5, 5)
    const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.where_document).toBeDefined()
  })
})

// ── batchInsert ───────────────────────────────────────────────────────────────

describe('ChromaAdapter.batchInsert', () => {
  it('returns success count and sends batch to /add', async () => {
    withId({})
    const result = await adapter().batchInsert('docs', [
      { properties: { content: 'A', tag: 'x' }, vector: [0.1] },
      { properties: { content: 'B', tag: 'y' }, vector: [0.2] },
    ])
    expect(result.success).toBe(2)
    expect(result.errors).toHaveLength(0)
    const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.ids).toHaveLength(2)
    expect(body.documents).toEqual(['A', 'B'])
    expect(body.metadatas[0]).toEqual({ tag: 'x' })
    expect(body.embeddings).toEqual([[0.1], [0.2]])
  })

  it('omits embeddings key when no vectors provided', async () => {
    withId({})
    await adapter().batchInsert('docs', [{ properties: { content: 'No vec' } }])
    const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.embeddings).toBeUndefined()
  })

  it('uses provided IDs when supplied', async () => {
    withId({})
    await adapter().batchInsert('docs', [{ id: 'custom-id', properties: { content: 'X' } }])
    const body = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(body.ids[0]).toBe('custom-id')
  })

  it('returns error on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('Chroma down'))
    const result = await adapter().batchInsert('docs', [{ properties: { content: 'X' } }])
    expect(result.success).toBe(0)
    expect(result.errors[0]).toContain('Chroma down')
  })

  it('includes Authorization header when apiKey configured', async () => {
    const authedConfig = { ...CONFIG, apiKey: 'chroma-token' }
    const a = new ChromaAdapter(authedConfig)
    mockFetch
      .mockResolvedValueOnce(ok(CHROMA_COLLECTION))
      .mockResolvedValueOnce(ok({}))
    await a.batchInsert('docs', [{ properties: { content: 'X' } }])
    const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer chroma-token')
  })
})
