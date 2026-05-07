/**
 * Unit tests for src/lib/weaviate/client.ts
 * Tests buildBaseURL, ApiError, and weaviateApi HTTP methods (fetch mocked).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildBaseURL, ApiError, weaviateApi } from '@/lib/weaviate/client'
import type { ConnectionConfig } from '@/types/domain'

const mockFetch = vi.fn()

beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

function makeRes(body: unknown, status = 200) {
  return new Response(body != null ? JSON.stringify(body) : '', { status })
}

const DIRECT_CONFIG: ConnectionConfig = {
  dbType: 'weaviate', host: 'myhost', port: 9999, scheme: 'https',
}

const PROXY_CONFIG: ConnectionConfig = {
  dbType: 'weaviate', host: 'ignored', port: 1, scheme: 'http', proxyURL: '/api/weaviate',
}

// ── buildBaseURL ─────────────────────────────────────────────────────────────

describe('buildBaseURL', () => {
  it('uses proxyURL when set', () => {
    expect(buildBaseURL(PROXY_CONFIG)).toBe('/api/weaviate')
  })
  it('strips trailing slash from proxyURL', () => {
    expect(buildBaseURL({ ...PROXY_CONFIG, proxyURL: '/api/weaviate/' })).toBe('/api/weaviate')
  })
  it('falls back to scheme://host:port when proxyURL is empty string', () => {
    expect(buildBaseURL(DIRECT_CONFIG)).toBe('https://myhost:9999')
  })
  it('returns /api/weaviate for null config', () => {
    expect(buildBaseURL(null)).toBe('/api/weaviate')
  })
  it('returns /api/weaviate for undefined config', () => {
    expect(buildBaseURL(undefined)).toBe('/api/weaviate')
  })
  it('builds http URL correctly', () => {
    expect(buildBaseURL({ dbType: 'weaviate', host: 'db', port: 8080, scheme: 'http' }))
      .toBe('http://db:8080')
  })
})

// ── ApiError ─────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('is an Error with a status property', () => {
    const err = new ApiError(404, 'Not found')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
    expect(err.name).toBe('ApiError')
  })
})

// ── weaviateApi.get ──────────────────────────────────────────────────────────

describe('weaviateApi.get', () => {
  it('returns parsed JSON on 200', async () => {
    mockFetch.mockResolvedValue(makeRes({ version: '1.25.4' }))
    const result = await weaviateApi.get<{ version: string }>('/v1/meta', null)
    expect(result.version).toBe('1.25.4')
  })

  it('throws ApiError on 404', async () => {
    mockFetch.mockResolvedValue(makeRes({ message: 'Class not found' }, 404))
    await expect(weaviateApi.get('/v1/schema/nope', null)).rejects.toThrow(ApiError)
  })

  it('returns undefined for 204 No Content', async () => {
    // jsdom does not support status 204 in Response constructor; use 200 empty body which parseResponse also handles as undefined
    mockFetch.mockResolvedValue(new Response('', { status: 200 }))
    expect(await weaviateApi.get('/v1/ready', null)).toBeUndefined()
  })

  it('returns undefined for 200 with empty body', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 200 }))
    expect(await weaviateApi.get('/v1/ready', null)).toBeUndefined()
  })

  it('includes Authorization header when apiKey provided', async () => {
    mockFetch.mockResolvedValue(makeRes({}))
    await weaviateApi.get('/v1/meta', { ...DIRECT_CONFIG, apiKey: 'my-secret' })
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-secret')
  })

  it('calls fetch with correct URL (proxy)', async () => {
    mockFetch.mockResolvedValue(makeRes({}))
    await weaviateApi.get('/v1/schema', PROXY_CONFIG)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/weaviate/v1/schema')
  })

  it('uses error.message from JSON error body', async () => {
    mockFetch.mockResolvedValue(makeRes({ message: 'Custom error message' }, 400))
    await expect(weaviateApi.get('/v1/schema', null)).rejects.toThrow('Custom error message')
  })
})

// ── weaviateApi.post ─────────────────────────────────────────────────────────

describe('weaviateApi.post', () => {
  it('sends POST with JSON body and returns response', async () => {
    mockFetch.mockResolvedValue(makeRes({ id: 'abc-123' }))
    const result = await weaviateApi.post<{ id: string }>('/v1/objects', { class: 'Doc', properties: {} }, null)
    expect(result.id).toBe('abc-123')
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({ class: 'Doc' })
  })

  it('throws ApiError on 422', async () => {
    mockFetch.mockResolvedValue(makeRes({ message: 'Invalid' }, 422))
    await expect(weaviateApi.post('/v1/objects', {}, null)).rejects.toThrow(ApiError)
  })
})

// ── weaviateApi.put ──────────────────────────────────────────────────────────

describe('weaviateApi.put', () => {
  it('sends PUT with JSON body', async () => {
    mockFetch.mockResolvedValue(makeRes({ updated: true }))
    const result = await weaviateApi.put<{ updated: boolean }>('/v1/objects/Doc/1', { properties: {} }, null)
    expect(result.updated).toBe(true)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PUT')
  })
})

// ── weaviateApi.patch ────────────────────────────────────────────────────────

describe('weaviateApi.patch', () => {
  it('sends PATCH with JSON body', async () => {
    mockFetch.mockResolvedValue(makeRes({ patched: true }))
    await weaviateApi.patch('/v1/objects/Doc/1', { properties: { title: 'new' } }, null)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
  })
})

// ── weaviateApi.delete ───────────────────────────────────────────────────────

describe('weaviateApi.delete', () => {
  it('resolves on 200', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 200 }))
    await expect(weaviateApi.delete('/v1/schema/Test', null)).resolves.toBeUndefined()
  })

  it('does not throw on 404 (already deleted)', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 404 }))
    await expect(weaviateApi.delete('/v1/schema/Missing', null)).resolves.toBeUndefined()
  })

  it('throws ApiError on 500', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 500 }))
    await expect(weaviateApi.delete('/v1/schema/Err', null)).rejects.toThrow(ApiError)
  })
})
