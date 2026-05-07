/**
 * Unit tests for PgvectorAdapter (PostgREST) — all methods tested via mocked fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PgvectorAdapter } from '@/lib/adapters/pgvector'
import type { ConnectionConfig } from '@/types/domain'

const mockFetch = vi.fn()

beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

const CONFIG: ConnectionConfig = {
  dbType: 'pgvector', host: 'localhost', port: 3000, scheme: 'http',
  proxyURL: '/api/pgvector',
}

function adapter() { return new PgvectorAdapter(CONFIG) }

const OPEN_API_SPEC = {
  info: { version: '12.2.0' },
  paths: {
    '/items':     {},
    '/documents': {},
    '/rpc/match_items': {},
    '/{id}':      {},   // parameterized — should be filtered out
  },
}

function ok(body: unknown, headers: Record<string, string> = {}) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
    })
  )
}

function fail(status: number, message = 'error') {
  return Promise.resolve(
    new Response(JSON.stringify({ message }), { status })
  )
}

function okRows(rows: unknown[], total: number) {
  return ok(rows, { 'Content-Range': `0-${(rows as unknown[]).length - 1}/${total}` })
}

function okEmpty(total: number) {
  return Promise.resolve(
    new Response('[]', {
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json', 'Content-Range': `*/${total}` }),
    })
  )
}

// ── checkHealth ───────────────────────────────────────────────────────────────

describe('PgvectorAdapter.checkHealth', () => {
  it('returns ready:true with PostgREST version', async () => {
    mockFetch.mockResolvedValue(ok(OPEN_API_SPEC))
    const h = await adapter().checkHealth()
    expect(h.ready).toBe(true)
    expect(h.version).toBe('12.2.0')
  })

  it('falls back to "PostgREST" when version missing from spec', async () => {
    mockFetch.mockResolvedValue(ok({ info: {}, paths: {} }))
    const h = await adapter().checkHealth()
    expect(h.ready).toBe(true)
    expect(h.version).toBe('PostgREST')
  })

  it('returns ready:false on HTTP error', async () => {
    mockFetch.mockResolvedValue(fail(503))
    const h = await adapter().checkHealth()
    expect(h.ready).toBe(false)
    expect(h.error).toContain('503')
  })

  it('returns ready:false on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const h = await adapter().checkHealth()
    expect(h.ready).toBe(false)
    expect(h.error).toContain('ECONNREFUSED')
  })
})

// ── listCollections ───────────────────────────────────────────────────────────

describe('PgvectorAdapter.listCollections', () => {
  it('returns table names from OpenAPI paths', async () => {
    mockFetch.mockResolvedValue(ok(OPEN_API_SPEC))
    const cols = await adapter().listCollections()
    const names = cols.map((c) => c.name)
    expect(names).toContain('items')
    expect(names).toContain('documents')
  })

  it('excludes /rpc/* paths', async () => {
    mockFetch.mockResolvedValue(ok(OPEN_API_SPEC))
    const cols = await adapter().listCollections()
    expect(cols.map((c) => c.name)).not.toContain('rpc/match_items')
  })

  it('excludes parameterized paths (containing {)', async () => {
    mockFetch.mockResolvedValue(ok(OPEN_API_SPEC))
    const cols = await adapter().listCollections()
    expect(cols.every((c) => !c.name.includes('{'))).toBe(true)
  })

  it('calls GET / with Accept: application/openapi+json', async () => {
    mockFetch.mockResolvedValue(ok(OPEN_API_SPEC))
    await adapter().listCollections()
    const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers?.Accept ?? (mockFetch.mock.calls[0][1] as RequestInit).headers).toBeDefined()
  })
})

// ── getCollection ─────────────────────────────────────────────────────────────

describe('PgvectorAdapter.getCollection', () => {
  it('returns name and objectCount from Content-Range', async () => {
    mockFetch.mockResolvedValue(okEmpty(42))
    const col = await adapter().getCollection('items')
    expect(col.name).toBe('items')
    expect(col.objectCount).toBe(42)
  })

  it('returns undefined objectCount when Content-Range absent', async () => {
    mockFetch.mockResolvedValue(ok([]))
    const col = await adapter().getCollection('items')
    expect(col.objectCount).toBeUndefined()
  })

  it('queries GET /tablename?limit=0', async () => {
    mockFetch.mockResolvedValue(okEmpty(10))
    await adapter().getCollection('items')
    expect(mockFetch.mock.calls[0][0]).toBe('/api/pgvector/items?limit=0')
  })
})

// ── createCollection ──────────────────────────────────────────────────────────

describe('PgvectorAdapter.createCollection', () => {
  it('throws explaining PostgREST DDL limitation', async () => {
    await expect(adapter().createCollection({ name: 'test' })).rejects.toThrow(/sql/i)
  })
})

// ── deleteCollection ──────────────────────────────────────────────────────────

describe('PgvectorAdapter.deleteCollection', () => {
  it('throws explaining PostgREST DDL limitation', async () => {
    await expect(adapter().deleteCollection('test')).rejects.toThrow(/sql/i)
  })
})

// ── getObjectCount ────────────────────────────────────────────────────────────

describe('PgvectorAdapter.getObjectCount', () => {
  it('extracts total from Content-Range header', async () => {
    mockFetch.mockResolvedValue(okEmpty(77))
    expect(await adapter().getObjectCount('items')).toBe(77)
  })

  it('returns 0 when Content-Range is absent', async () => {
    mockFetch.mockResolvedValue(ok([]))
    expect(await adapter().getObjectCount('items')).toBe(0)
  })
})

// ── listObjects ───────────────────────────────────────────────────────────────

describe('PgvectorAdapter.listObjects', () => {
  it('returns rows mapped to DBObject with total from Content-Range', async () => {
    const rows = [
      { id: 'uuid-1', content: 'hello', embedding: [0.1, 0.2, 0.3] },
      { id: 'uuid-2', content: 'world', embedding: [0.4, 0.5, 0.6] },
    ]
    mockFetch.mockResolvedValue(okRows(rows, 50))
    const result = await adapter().listObjects('items', 10, 0)
    expect(result.total).toBe(50)
    expect(result.objects).toHaveLength(2)
    expect(result.objects[0].id).toBe('uuid-1')
    expect(result.objects[0].properties.content).toBe('hello')
    expect(result.objects[0].vector).toEqual([0.1, 0.2, 0.3])
  })

  it('excludes embedding column from properties', async () => {
    mockFetch.mockResolvedValue(okRows([{ id: '1', text: 'hi', embedding: [0.1] }], 1))
    const { objects } = await adapter().listObjects('items', 1, 0)
    expect(objects[0].properties.embedding).toBeUndefined()
    expect(objects[0].vector).toEqual([0.1])
  })

  it('parses vector stored as PostgreSQL string "[0.1,0.2,0.3]"', async () => {
    mockFetch.mockResolvedValue(okRows([{ id: '1', embedding: '[0.1,0.2,0.3]' }], 1))
    const { objects } = await adapter().listObjects('items', 1, 0)
    expect(objects[0].vector).toEqual([0.1, 0.2, 0.3])
  })

  it('uses limit and offset in query params', async () => {
    mockFetch.mockResolvedValue(okRows([], 0))
    await adapter().listObjects('items', 25, 50)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('limit=25')
    expect(url).toContain('offset=50')
  })

  it('handles rows without a vector column gracefully', async () => {
    mockFetch.mockResolvedValue(okRows([{ id: '1', content: 'no vec' }], 1))
    const { objects } = await adapter().listObjects('items', 1, 0)
    expect(objects[0].vector).toBeUndefined()
  })
})

// ── createObject ──────────────────────────────────────────────────────────────

describe('PgvectorAdapter.createObject', () => {
  it('returns the id from the created row', async () => {
    mockFetch.mockResolvedValue(ok([{ id: 'new-uuid', content: 'test' }]))
    const id = await adapter().createObject('items', { content: 'test' }, [0.1])
    expect(id).toBe('new-uuid')
  })

  it('sends POST with properties and embedding', async () => {
    mockFetch.mockResolvedValue(ok([{ id: 'x' }]))
    await adapter().createObject('items', { content: 'hello' }, [0.5, 0.6])
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/pgvector/items')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.content).toBe('hello')
    expect(body.embedding).toEqual([0.5, 0.6])
  })

  it('sends POST without embedding when no vector provided', async () => {
    mockFetch.mockResolvedValue(ok([{ id: 'x' }]))
    await adapter().createObject('items', { content: 'no-vec' })
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.embedding).toBeUndefined()
  })
})

// ── deleteObject ──────────────────────────────────────────────────────────────

describe('PgvectorAdapter.deleteObject', () => {
  it('sends DELETE to /tablename?id=eq.{id}', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }))
    await adapter().deleteObject('items', 'abc-123')
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/pgvector/items?id=eq.abc-123')
    expect((init as RequestInit).method).toBe('DELETE')
  })
})

// ── vectorSearch ──────────────────────────────────────────────────────────────

describe('PgvectorAdapter.vectorSearch', () => {
  it('calls /rpc/match_{table} with query_embedding and match_count', async () => {
    mockFetch.mockResolvedValue(ok([{ id: '1', similarity: 0.95 }]))
    await adapter().vectorSearch('items', [0.1, 0.2], 5)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rpc/match_items')
    const body = JSON.parse(init.body as string)
    expect(body.query_embedding).toEqual([0.1, 0.2])
    expect(body.match_count).toBe(5)
  })

  it('maps similarity → score', async () => {
    mockFetch.mockResolvedValue(ok([
      { id: 'a', similarity: 0.98, content: 'top' },
      { id: 'b', similarity: 0.75, content: 'second' },
    ]))
    const results = await adapter().vectorSearch('items', [], 5)
    expect(results[0].score).toBe(0.98)
    expect(results[1].score).toBe(0.75)
    expect(results[0].id).toBe('a')
  })

  it('throws with guidance to create the RPC function on HTTP error', async () => {
    mockFetch.mockResolvedValue(fail(404, 'function not found'))
    await expect(adapter().vectorSearch('items', [0.1], 5)).rejects.toThrow(/match_items/)
  })
})

// ── keywordSearch ─────────────────────────────────────────────────────────────

describe('PgvectorAdapter.keywordSearch', () => {
  it('uses ilike filter on first property or "content" by default', async () => {
    mockFetch.mockResolvedValue(okRows([{ id: '1', content: 'hello world' }], 1))
    await adapter().keywordSearch('items', 'hello', 5)
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('content=ilike')
    expect(url).toContain('hello')
    expect(url).toContain('limit=5')
  })

  it('uses provided properties[0] as search column', async () => {
    mockFetch.mockResolvedValue(okRows([], 0))
    await adapter().keywordSearch('items', 'test', 5, ['title'])
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('title=ilike')
  })

  it('returns results as SearchResult array', async () => {
    mockFetch.mockResolvedValue(okRows([{ id: '1', content: 'match' }], 1))
    const results = await adapter().keywordSearch('items', 'match', 5)
    expect(results[0].id).toBe('1')
    expect(results[0].score).toBe(1)
    expect(results[0].class).toBe('items')
  })
})

// ── hybridSearch ──────────────────────────────────────────────────────────────

describe('PgvectorAdapter.hybridSearch', () => {
  it('delegates to vectorSearch when vector is provided', async () => {
    mockFetch.mockResolvedValue(ok([{ id: '1', similarity: 0.9 }]))
    await adapter().hybridSearch('items', 'query', [0.1, 0.2], 0.5, 5)
    expect(mockFetch.mock.calls[0][0]).toContain('/rpc/match_items')
  })

  it('delegates to keywordSearch when no vector', async () => {
    mockFetch.mockResolvedValue(okRows([{ id: '1', content: 'match' }], 1))
    const results = await adapter().hybridSearch('items', 'match', undefined, 0.5, 5)
    expect(results[0].id).toBe('1')
  })
})

// ── batchInsert ───────────────────────────────────────────────────────────────

describe('PgvectorAdapter.batchInsert', () => {
  it('returns success count equal to input count', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 201 }))
    const result = await adapter().batchInsert('items', [
      { properties: { content: 'A' }, vector: [0.1] },
      { properties: { content: 'B' }, vector: [0.2] },
    ])
    expect(result.success).toBe(2)
    expect(result.errors).toHaveLength(0)
  })

  it('sends POST with array of row objects', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 201 }))
    await adapter().batchInsert('items', [
      { id: 'my-id', properties: { content: 'Hello' }, vector: [0.1, 0.2] },
    ])
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/pgvector/items')
    const body = JSON.parse(init.body as string)
    expect(Array.isArray(body)).toBe(true)
    expect(body[0].id).toBe('my-id')
    expect(body[0].content).toBe('Hello')
    expect(body[0].embedding).toEqual([0.1, 0.2])
  })

  it('returns error on HTTP failure', async () => {
    mockFetch.mockResolvedValue(fail(500, 'duplicate key'))
    const result = await adapter().batchInsert('items', [{ properties: {} }])
    expect(result.success).toBe(0)
    expect(result.errors).toHaveLength(1)
  })

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))
    const result = await adapter().batchInsert('items', [{ properties: {} }])
    expect(result.success).toBe(0)
    expect(result.errors[0]).toContain('Network error')
  })
})

// ── auth ──────────────────────────────────────────────────────────────────────

describe('PgvectorAdapter auth', () => {
  it('sends Authorization: Bearer header when apiKey is set', async () => {
    const authedConfig = { ...CONFIG, apiKey: 'my-jwt-token' }
    const a = new PgvectorAdapter(authedConfig)
    mockFetch.mockResolvedValue(ok(OPEN_API_SPEC))
    await a.checkHealth()
    const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers?.Authorization).toBe('Bearer my-jwt-token')
  })

  it('omits Authorization header when no apiKey', async () => {
    const noKeyConfig = { ...CONFIG, apiKey: undefined }
    const a = new PgvectorAdapter(noKeyConfig)
    mockFetch.mockResolvedValue(ok(OPEN_API_SPEC))
    await a.checkHealth()
    const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers?.Authorization).toBeUndefined()
  })
})
