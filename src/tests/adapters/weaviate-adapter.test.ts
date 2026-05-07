/**
 * Unit tests for WeaviateAdapter — all methods tested via mocked fetch.
 * The adapter delegates to @/lib/weaviate/* helpers which use weaviateApi → fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WeaviateAdapter } from '@/lib/adapters/weaviate'
import type { ConnectionConfig } from '@/types/domain'

const mockFetch = vi.fn()

beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

const CONFIG: ConnectionConfig = {
  dbType: 'weaviate', host: 'localhost', port: 8080, scheme: 'http',
  proxyURL: '/api/weaviate',
}

function adapter() { return new WeaviateAdapter(CONFIG) }

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}
function noContent() {
  // jsdom does not accept status 204 in Response constructor; use 200 empty body
  return Promise.resolve(new Response('', { status: 200 }))
}
function err(status: number, message = 'Error') {
  return Promise.resolve(new Response(JSON.stringify({ message }), { status }))
}

const WEAVIATE_COLLECTION = {
  class: 'Documents',
  description: 'Test collection',
  vectorizer: 'none',
  vectorIndexConfig: { distance: 'cosine' },
  properties: [
    { name: 'content', dataType: ['text'], indexSearchable: true, indexFilterable: true },
    { name: 'source', dataType: ['text'], indexSearchable: false, indexFilterable: true },
  ],
}

const WEAVIATE_OBJECT = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  class: 'Documents',
  properties: { content: 'Hello world', source: 'test' },
  vector: [0.1, 0.2, 0.3],
}

const GQL_GET = (items: unknown[]) => ({
  data: { Get: { Documents: items } },
})
const GQL_AGG = (count: number) => ({
  data: { Aggregate: { Documents: [{ meta: { count } }] } },
})
const GQL_ITEM = (content = 'text', id = 'id-001') => ({
  content,
  _additional: { id, score: 0.9, certainty: 0.85, distance: 0.15 },
})

// ── checkHealth ───────────────────────────────────────────────────────────────

describe('WeaviateAdapter.checkHealth', () => {
  it('returns ready:true with version when Weaviate responds', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('', { status: 200 }))       // /v1/.well-known/ready
      .mockResolvedValueOnce(ok({ version: '1.25.4' }))               // /v1/meta
    const status = await adapter().checkHealth()
    expect(status.ready).toBe(true)
    expect(status.version).toBe('1.25.4')
  })

  it('returns ready:false with error message when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const status = await adapter().checkHealth()
    expect(status.ready).toBe(false)
    expect(status.error).toContain('ECONNREFUSED')
  })

  it('returns ready:false when /v1/.well-known/ready returns 503', async () => {
    mockFetch.mockResolvedValue(err(503, 'Service unavailable'))
    const status = await adapter().checkHealth()
    expect(status.ready).toBe(false)
  })
})

// ── listCollections ───────────────────────────────────────────────────────────

describe('WeaviateAdapter.listCollections', () => {
  it('returns normalized collection list', async () => {
    mockFetch.mockResolvedValue(ok({ classes: [WEAVIATE_COLLECTION] }))
    const cols = await adapter().listCollections()
    expect(cols).toHaveLength(1)
    expect(cols[0].name).toBe('Documents')
    expect(cols[0].distance).toBe('cosine')
    expect(cols[0].vectorizer).toBe('none')
    expect(cols[0].properties).toHaveLength(2)
  })

  it('normalizes properties (dataType[0] → dataType, indexSearchable → searchable)', async () => {
    mockFetch.mockResolvedValue(ok({ classes: [WEAVIATE_COLLECTION] }))
    const [col] = await adapter().listCollections()
    const contentProp = col.properties!.find((p) => p.name === 'content')!
    expect(contentProp.dataType).toBe('text')
    expect(contentProp.searchable).toBe(true)
    expect(contentProp.filterable).toBe(true)
    const sourceProp = col.properties!.find((p) => p.name === 'source')!
    expect(sourceProp.searchable).toBe(false)
  })

  it('returns empty array when no collections exist', async () => {
    mockFetch.mockResolvedValue(ok({ classes: [] }))
    expect(await adapter().listCollections()).toEqual([])
  })
})

// ── getCollection ─────────────────────────────────────────────────────────────

describe('WeaviateAdapter.getCollection', () => {
  it('returns a single normalized collection', async () => {
    mockFetch.mockResolvedValue(ok(WEAVIATE_COLLECTION))
    const col = await adapter().getCollection('Documents')
    expect(col.name).toBe('Documents')
    expect(col.description).toBe('Test collection')
  })

  it('throws on 404', async () => {
    mockFetch.mockResolvedValue(err(404, 'Class not found'))
    await expect(adapter().getCollection('Nonexistent')).rejects.toThrow()
  })
})

// ── createCollection ──────────────────────────────────────────────────────────

describe('WeaviateAdapter.createCollection', () => {
  it('calls POST /v1/schema with correct body', async () => {
    mockFetch.mockResolvedValue(ok(WEAVIATE_COLLECTION))
    await adapter().createCollection({
      name: 'Documents',
      description: 'Test',
      distance: 'cosine',
      properties: [{ name: 'content', dataType: 'text' }],
    })
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v1/schema')
    const body = JSON.parse(init.body as string)
    expect(body.class).toBe('Documents')
    expect(body.vectorizer).toBe('none')
    expect(body.vectorIndexConfig.distance).toBe('cosine')
    expect(body.properties[0].name).toBe('content')
  })

  it('defaults distance to cosine when not specified', async () => {
    mockFetch.mockResolvedValue(ok(WEAVIATE_COLLECTION))
    await adapter().createCollection({ name: 'MyCol' })
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.vectorIndexConfig.distance).toBe('cosine')
  })
})

// ── deleteCollection ──────────────────────────────────────────────────────────

describe('WeaviateAdapter.deleteCollection', () => {
  it('sends DELETE to /v1/schema/:name', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 200 }))
    await adapter().deleteCollection('Documents')
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/schema/Documents')
    expect((mockFetch.mock.calls[0][1] as RequestInit).method).toBe('DELETE')
  })
})

// ── getObjectCount ────────────────────────────────────────────────────────────

describe('WeaviateAdapter.getObjectCount', () => {
  it('returns count from GraphQL Aggregate query', async () => {
    mockFetch.mockResolvedValue(ok(GQL_AGG(42)))
    const count = await adapter().getObjectCount('Documents')
    expect(count).toBe(42)
  })

  it('returns 0 when aggregate returns nothing', async () => {
    mockFetch.mockResolvedValue(ok({ data: { Aggregate: { Documents: [] } } }))
    expect(await adapter().getObjectCount('Documents')).toBe(0)
  })
})

// ── listObjects ───────────────────────────────────────────────────────────────

describe('WeaviateAdapter.listObjects', () => {
  it('returns normalized objects with total', async () => {
    mockFetch.mockResolvedValue(ok({
      objects: [WEAVIATE_OBJECT],
      totalResults: 1,
    }))
    const result = await adapter().listObjects('Documents', 25, 0)
    expect(result.total).toBe(1)
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0].id).toBe(WEAVIATE_OBJECT.id)
    expect(result.objects[0].properties.content).toBe('Hello world')
    expect(result.objects[0].vector).toEqual([0.1, 0.2, 0.3])
  })

  it('passes limit and offset as query params', async () => {
    mockFetch.mockResolvedValue(ok({ objects: [], totalResults: 0 }))
    await adapter().listObjects('Documents', 10, 20)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('limit=10')
    expect(url).toContain('offset=20')
  })
})

// ── createObject ──────────────────────────────────────────────────────────────

describe('WeaviateAdapter.createObject', () => {
  it('returns new object ID', async () => {
    mockFetch.mockResolvedValue(ok(WEAVIATE_OBJECT))
    const id = await adapter().createObject('Documents', { content: 'New' }, [0.1, 0.2])
    expect(id).toBe(WEAVIATE_OBJECT.id)
  })

  it('includes vector in POST body when provided', async () => {
    mockFetch.mockResolvedValue(ok(WEAVIATE_OBJECT))
    await adapter().createObject('Documents', { content: 'Text' }, [1, 2, 3])
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.vector).toEqual([1, 2, 3])
    expect(body.class).toBe('Documents')
  })
})

// ── deleteObject ──────────────────────────────────────────────────────────────

describe('WeaviateAdapter.deleteObject', () => {
  it('sends DELETE to /v1/objects/:class/:id', async () => {
    mockFetch.mockResolvedValue(noContent())
    await adapter().deleteObject('Documents', WEAVIATE_OBJECT.id)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain(`/v1/objects/Documents/${WEAVIATE_OBJECT.id}`)
    expect((mockFetch.mock.calls[0][1] as RequestInit).method).toBe('DELETE')
  })
})

// ── vectorSearch ──────────────────────────────────────────────────────────────

describe('WeaviateAdapter.vectorSearch', () => {
  it('returns search results mapped from GraphQL', async () => {
    mockFetch.mockResolvedValue(ok(GQL_GET([GQL_ITEM('relevant doc')])))
    const results = await adapter().vectorSearch('Documents', [0.1, 0.2], 5, ['content'])
    expect(results).toHaveLength(1)
    expect(results[0].properties.content).toBe('relevant doc')
    expect(results[0].certainty).toBe(0.85)
  })

  it('sends nearVector in GraphQL query', async () => {
    mockFetch.mockResolvedValue(ok(GQL_GET([])))
    await adapter().vectorSearch('Documents', [0.5, 0.6], 3, ['content'])
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.query).toContain('nearVector')
    expect(body.query).toContain('0.5,0.6')
  })
})

// ── keywordSearch ─────────────────────────────────────────────────────────────

describe('WeaviateAdapter.keywordSearch', () => {
  it('sends bm25 query and returns results', async () => {
    mockFetch.mockResolvedValue(ok(GQL_GET([GQL_ITEM('bm25 result')])))
    const results = await adapter().keywordSearch('Documents', 'hello', 5, ['content'])
    expect(results[0].properties.content).toBe('bm25 result')
  })

  it('GraphQL query contains bm25 keyword', async () => {
    mockFetch.mockResolvedValue(ok(GQL_GET([])))
    await adapter().keywordSearch('Documents', 'search term', 5, ['content'])
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.query).toContain('bm25')
    expect(body.query).toContain('search term')
  })
})

// ── hybridSearch ──────────────────────────────────────────────────────────────

describe('WeaviateAdapter.hybridSearch', () => {
  it('sends hybrid query with alpha and vector', async () => {
    mockFetch.mockResolvedValue(ok(GQL_GET([GQL_ITEM('hybrid result')])))
    const results = await adapter().hybridSearch('Documents', 'query', [0.3, 0.4], 0.7, 5, ['content'])
    expect(results[0].properties.content).toBe('hybrid result')
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.query).toContain('hybrid')
    expect(body.query).toContain('alpha: 0.7')
  })

  it('works without a vector (alpha only)', async () => {
    mockFetch.mockResolvedValue(ok(GQL_GET([])))
    await expect(adapter().hybridSearch('Documents', 'query', undefined, 0.5, 5, ['content'])).resolves.toBeDefined()
  })
})

// ── batchInsert ───────────────────────────────────────────────────────────────

describe('WeaviateAdapter.batchInsert', () => {
  it('returns success count equal to number of objects', async () => {
    const batchResponse = [
      { id: 'a', result: { status: 'SUCCESS' } },
      { id: 'b', result: { status: 'SUCCESS' } },
    ]
    mockFetch.mockResolvedValue(ok(batchResponse))
    const result = await adapter().batchInsert('Documents', [
      { properties: { content: 'Doc 1' }, vector: [0.1] },
      { properties: { content: 'Doc 2' }, vector: [0.2] },
    ])
    expect(result.success).toBe(2)
    expect(result.errors).toHaveLength(0)
  })

  it('reports errors from batch response', async () => {
    const batchResponse = [
      { id: 'a', result: { status: 'SUCCESS' } },
      { id: 'b', result: { errors: { error: [{ message: 'Invalid vector length' }] } } },
    ]
    mockFetch.mockResolvedValue(ok(batchResponse))
    const result = await adapter().batchInsert('Documents', [
      { properties: { content: 'Doc 1' } },
      { properties: { content: 'Doc 2' } },
    ])
    expect(result.success).toBe(1)
    expect(result.errors).toContain('Invalid vector length')
  })

  it('sends POST to /v1/batch/objects with objects array', async () => {
    mockFetch.mockResolvedValue(ok([]))
    await adapter().batchInsert('Documents', [{ properties: { content: 'Item' } }])
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v1/batch/objects')
    const body = JSON.parse(init.body as string)
    expect(Array.isArray(body.objects)).toBe(true)
    expect(body.objects[0].class).toBe('Documents')
  })
})
