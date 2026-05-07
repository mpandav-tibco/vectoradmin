/**
 * Unit tests for src/lib/embedding/client.ts
 * Tests all providers (ollama, openai, cohere, custom) via mocked fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { embed, embedSingle } from '@/lib/embedding/client'
import type { EmbeddingConfig } from '@/types/domain'

const mockFetch = vi.fn()

beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}
function fail(status: number) {
  return Promise.resolve(new Response(JSON.stringify({ error: { message: `HTTP ${status}` } }), { status }))
}

const VECTOR = [0.1, 0.2, 0.3, 0.4]

// ── Ollama provider ───────────────────────────────────────────────────────────

describe('embed — ollama provider', () => {
  const config: EmbeddingConfig = { provider: 'ollama', model: 'nomic-embed-text' }

  it('returns embedding vectors for each input text', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ embeddings: [VECTOR] }))
      .mockResolvedValueOnce(ok({ embeddings: [[0.5, 0.6]] }))
    const results = await embed(['text one', 'text two'], config)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual(VECTOR)
    expect(results[1]).toEqual([0.5, 0.6])
  })

  it('sends one request per text (sequential)', async () => {
    // Use mockImplementation so each call gets a fresh Response body (bodies can only be read once)
    mockFetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ embeddings: [VECTOR] }), { status: 200 })))
    await embed(['a', 'b', 'c'], config)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('uses /api/ollama as default base URL', async () => {
    mockFetch.mockResolvedValue(ok({ embeddings: [VECTOR] }))
    await embed(['text'], config)
    expect(mockFetch.mock.calls[0][0]).toBe('/api/ollama/api/embed')
  })

  it('uses configured baseURL when provided', async () => {
    mockFetch.mockResolvedValue(ok({ embeddings: [VECTOR] }))
    await embed(['text'], { ...config, baseURL: 'http://ollama:11434' })
    expect(mockFetch.mock.calls[0][0]).toBe('http://ollama:11434/api/embed')
  })

  it('sends model and input in request body', async () => {
    mockFetch.mockResolvedValue(ok({ embeddings: [VECTOR] }))
    await embed(['hello world'], config)
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('nomic-embed-text')
    expect(body.input).toBe('hello world')
  })

  it('falls back to data.embedding when embeddings array is absent', async () => {
    mockFetch.mockResolvedValue(ok({ embedding: VECTOR }))
    const results = await embed(['text'], config)
    expect(results[0]).toEqual(VECTOR)
  })

  it('throws with hint when fetch fails (Ollama unreachable)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(embed(['text'], config)).rejects.toThrow(/Cannot reach Ollama/)
  })

  it('throws on non-200 response', async () => {
    mockFetch.mockResolvedValue(fail(500))
    await expect(embed(['text'], config)).rejects.toThrow(/Ollama embedding failed/)
  })
})

// ── OpenAI provider ───────────────────────────────────────────────────────────

describe('embed — openai provider', () => {
  const config: EmbeddingConfig = {
    provider: 'openai', model: 'text-embedding-3-small', apiKey: 'sk-test',
  }

  const OPENAI_RESP = {
    data: [
      { index: 0, embedding: [0.1, 0.2] },
      { index: 1, embedding: [0.3, 0.4] },
    ],
  }

  it('returns embeddings sorted by index', async () => {
    // Server returns them in reverse order
    mockFetch.mockResolvedValue(ok({
      data: [
        { index: 1, embedding: [0.3, 0.4] },
        { index: 0, embedding: [0.1, 0.2] },
      ],
    }))
    const results = await embed(['text1', 'text2'], config)
    expect(results[0]).toEqual([0.1, 0.2])
    expect(results[1]).toEqual([0.3, 0.4])
  })

  it('sends all texts in a single request', async () => {
    mockFetch.mockResolvedValue(ok(OPENAI_RESP))
    await embed(['a', 'b'], config)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.input).toEqual(['a', 'b'])
    expect(body.model).toBe('text-embedding-3-small')
  })

  it('includes Authorization header', async () => {
    mockFetch.mockResolvedValue(ok(OPENAI_RESP))
    await embed(['text'], config)
    const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer sk-test')
  })

  it('uses api.openai.com as default base URL', async () => {
    mockFetch.mockResolvedValue(ok(OPENAI_RESP))
    await embed(['text'], config)
    expect(mockFetch.mock.calls[0][0]).toContain('api.openai.com')
  })

  it('uses configured baseURL when provided', async () => {
    mockFetch.mockResolvedValue(ok(OPENAI_RESP))
    await embed(['text'], { ...config, baseURL: 'https://my-openai-proxy.com' })
    expect(mockFetch.mock.calls[0][0]).toContain('my-openai-proxy.com')
  })

  it('throws with error message from API on non-200', async () => {
    mockFetch.mockResolvedValue(ok({ error: { message: 'Invalid API key' } }))
    // The response is 200 but has an error body — for now the function uses resp.ok
    // Test the actual HTTP error path:
    mockFetch.mockReset()
    mockFetch.mockResolvedValue(fail(401))
    await expect(embed(['text'], config)).rejects.toThrow()
  })

  it('throws with hint when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))
    await expect(embed(['text'], config)).rejects.toThrow(/Cannot reach/)
  })
})

// ── Custom provider (OpenAI-compatible) ──────────────────────────────────────

describe('embed — custom provider', () => {
  const config: EmbeddingConfig = {
    provider: 'custom', model: 'my-model', apiKey: 'token', baseURL: 'http://myserver.local',
  }

  it('hits the custom base URL', async () => {
    mockFetch.mockResolvedValue(ok({ data: [{ index: 0, embedding: VECTOR }] }))
    await embed(['text'], config)
    expect(mockFetch.mock.calls[0][0]).toContain('myserver.local')
  })

  it('throws with "custom endpoint" hint on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))
    await expect(embed(['text'], config)).rejects.toThrow(/custom endpoint/)
  })
})

// ── Cohere provider ───────────────────────────────────────────────────────────

describe('embed — cohere provider', () => {
  const config: EmbeddingConfig = {
    provider: 'cohere', model: 'embed-english-v3.0', apiKey: 'cohere-key',
  }

  it('returns float embeddings from Cohere response', async () => {
    mockFetch.mockResolvedValue(ok({ embeddings: { float: [[0.1, 0.2], [0.3, 0.4]] } }))
    const results = await embed(['text1', 'text2'], config)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual([0.1, 0.2])
  })

  it('sends all texts in one request', async () => {
    mockFetch.mockResolvedValue(ok({ embeddings: { float: [VECTOR] } }))
    await embed(['hello'], config)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('includes Authorization Bearer header', async () => {
    mockFetch.mockResolvedValue(ok({ embeddings: { float: [VECTOR] } }))
    await embed(['text'], config)
    const headers = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer cohere-key')
  })

  it('throws on non-200 response', async () => {
    mockFetch.mockResolvedValue(fail(401))
    await expect(embed(['text'], config)).rejects.toThrow(/Cohere embedding failed/)
  })
})

// ── Unknown provider ──────────────────────────────────────────────────────────

describe('embed — unknown provider', () => {
  it('throws for unrecognized provider', async () => {
    const config = { provider: 'notareal' as never, model: 'x' }
    await expect(embed(['text'], config)).rejects.toThrow(/Unknown embedding provider/)
  })
})

// ── embedSingle ───────────────────────────────────────────────────────────────

describe('embedSingle', () => {
  const config: EmbeddingConfig = { provider: 'ollama', model: 'nomic-embed-text' }

  it('returns the first (and only) vector from embed()', async () => {
    mockFetch.mockResolvedValue(ok({ embeddings: [VECTOR] }))
    const result = await embedSingle('my text', config)
    expect(result).toEqual(VECTOR)
    expect(Array.isArray(result)).toBe(true)
  })

  it('calls embed with a single-element array', async () => {
    mockFetch.mockResolvedValue(ok({ embeddings: [VECTOR] }))
    await embedSingle('only this', config)
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.input).toBe('only this')
  })
})
