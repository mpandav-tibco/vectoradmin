/**
 * Integration tests against a live Weaviate instance at localhost:8080.
 * Run with: npm run test:integration
 * Requires Weaviate to be running: docker compose up -d weaviate
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const BASE = 'http://localhost:8080'
const TEST_CLASS = `TestCollection_${Date.now()}`

async function weaviate<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  return text ? JSON.parse(text) : (undefined as T)
}

describe('Weaviate live connection', () => {
  it('GET /v1/.well-known/ready returns 200 with empty body', async () => {
    const res = await fetch(`${BASE}/v1/.well-known/ready`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body.length).toBe(0)
  })

  it('GET /v1/meta returns version string', async () => {
    const meta = await weaviate<{ version: string }>('GET', '/v1/meta')
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('GET /v1/schema returns classes array', async () => {
    const schema = await weaviate<{ classes: unknown[] }>('GET', '/v1/schema')
    expect(Array.isArray(schema.classes)).toBe(true)
  })
})

describe('Weaviate CRUD lifecycle', () => {
  const testObjectId = '00000000-0000-0000-0000-000000000001'

  beforeAll(async () => {
    // Create a test collection
    await weaviate('POST', '/v1/schema', {
      class: TEST_CLASS,
      vectorizer: 'none',
      properties: [
        { name: 'content', dataType: ['text'] },
        { name: 'source', dataType: ['text'] },
      ],
    })
  })

  afterAll(async () => {
    // Clean up — delete test collection and all its objects
    await fetch(`${BASE}/v1/schema/${TEST_CLASS}`, { method: 'DELETE' }).catch(() => {})
  })

  it('created collection appears in schema', async () => {
    const schema = await weaviate<{ classes: { class: string }[] }>('GET', '/v1/schema')
    const found = schema.classes.find((c) => c.class === TEST_CLASS)
    expect(found).toBeDefined()
  })

  it('GET /v1/schema/:class returns collection detail', async () => {
    const col = await weaviate<{ class: string; properties: { name: string }[] }>('GET', `/v1/schema/${TEST_CLASS}`)
    expect(col.class).toBe(TEST_CLASS)
    expect(col.properties.some((p) => p.name === 'content')).toBe(true)
  })

  it('POST /v1/objects creates an object', async () => {
    const obj = await weaviate<{ id: string }>('POST', '/v1/objects', {
      class: TEST_CLASS,
      id: testObjectId,
      properties: { content: 'Hello world from integration test', source: 'test-suite' },
    })
    expect(obj.id).toBe(testObjectId)
  })

  it('GET /v1/objects/:class/:id retrieves the created object', async () => {
    const obj = await weaviate<{ id: string; properties: Record<string, string> }>(
      'GET', `/v1/objects/${TEST_CLASS}/${testObjectId}`
    )
    expect(obj.id).toBe(testObjectId)
    expect(obj.properties.content).toBe('Hello world from integration test')
    expect(obj.properties.source).toBe('test-suite')
  })

  it('PATCH /v1/objects/:class/:id updates a property', async () => {
    await weaviate('PATCH', `/v1/objects/${TEST_CLASS}/${testObjectId}`, {
      properties: { source: 'updated-by-test' },
    })
    const obj = await weaviate<{ properties: Record<string, string> }>(
      'GET', `/v1/objects/${TEST_CLASS}/${testObjectId}`
    )
    expect(obj.properties.source).toBe('updated-by-test')
  })

  it('POST /v1/batch/objects inserts multiple objects', async () => {
    const batch = [
      { class: TEST_CLASS, properties: { content: 'Batch item 1', source: 'batch' } },
      { class: TEST_CLASS, properties: { content: 'Batch item 2', source: 'batch' } },
      { class: TEST_CLASS, properties: { content: 'Batch item 3', source: 'batch' } },
    ]
    // Weaviate batch returns a top-level array, not { results: [] }
    const results = await weaviate<{ result: { status: string } }[]>('POST', '/v1/batch/objects', {
      objects: batch,
    })
    expect(Array.isArray(results)).toBe(true)
    expect(results).toHaveLength(3)
    results.forEach((r) => expect(r.result.status).toBe('SUCCESS'))
  })

  it('GraphQL BM25 search handles double quotes in query without syntax error', async () => {
    // Simulates user pasting "category": "connectivity" into the search box
    const escaped = '"category": "connectivity"'.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const query = { query: `{ Get { ${TEST_CLASS}(bm25: { query: "${escaped}" }, limit: 3) { content } } }` }
    const result = await weaviate<{ data?: unknown; errors?: { message: string }[] }>(
      'POST', '/v1/graphql', query
    )
    expect(result.errors).toBeUndefined()
  })

  it('GraphQL BM25 search finds inserted content', async () => {
    const query = {
      query: `{
        Get {
          ${TEST_CLASS}(bm25: { query: "Batch item" }, limit: 5) {
            content
            source
          }
        }
      }`,
    }
    const result = await weaviate<{ data: { Get: Record<string, { content: string }[]> } }>(
      'POST', '/v1/graphql', query
    )
    const hits = result.data?.Get?.[TEST_CLASS] ?? []
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.content.includes('Batch'))).toBe(true)
  })

  it('Aggregate query returns object count', async () => {
    const query = {
      query: `{ Aggregate { ${TEST_CLASS} { meta { count } } } }`,
    }
    const result = await weaviate<{ data: { Aggregate: Record<string, [{ meta: { count: number } }]> } }>(
      'POST', '/v1/graphql', query
    )
    const count = result.data?.Aggregate?.[TEST_CLASS]?.[0]?.meta?.count ?? 0
    expect(count).toBeGreaterThanOrEqual(4) // 1 individual + 3 batch
  })

  it('DELETE /v1/objects/:class/:id removes the object', async () => {
    await weaviate('DELETE', `/v1/objects/${TEST_CLASS}/${testObjectId}`)
    const res = await fetch(`${BASE}/v1/objects/${TEST_CLASS}/${testObjectId}`)
    expect(res.status).toBe(404)
  })
})
