/**
 * Unit tests for src/lib/rag/pipeline.ts
 * External dependencies (embedding, graphql, LLM fetch) are mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { EmbeddingConfig, LLMConfig, SearchResult } from '@/types/domain'

vi.mock('@/lib/embedding/client', () => ({
  embedSingle: vi.fn(),
  embed: vi.fn(),
}))

vi.mock('@/lib/weaviate/graphql', () => ({
  nearVectorSearch: vi.fn(),
  bm25Search: vi.fn(),
  hybridSearch: vi.fn(),
}))

import { runRAGQuery } from '@/lib/rag/pipeline'
import { embedSingle } from '@/lib/embedding/client'
import { nearVectorSearch, bm25Search, hybridSearch } from '@/lib/weaviate/graphql'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  vi.mocked(embedSingle).mockReset()
  vi.mocked(nearVectorSearch).mockReset()
  vi.mocked(bm25Search).mockReset()
  vi.mocked(hybridSearch).mockReset()
})

afterEach(() => { vi.unstubAllGlobals() })

const EMBED_CONFIG: EmbeddingConfig = { provider: 'ollama', model: 'nomic-embed-text' }
const LLM_CONFIG: LLMConfig = { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' }

const SOURCES: SearchResult[] = [
  { id: 'src-1', score: 0.9, class: 'Docs', properties: { content: 'The capital of France is Paris.' } },
  { id: 'src-2', score: 0.7, class: 'Docs', properties: { content: 'Paris is also known as the City of Light.' } },
]

const TEST_VECTOR = [0.1, 0.2, 0.3]

function mockLLMNonStream(answer: string) {
  mockFetch.mockResolvedValue(new Response(
    JSON.stringify({ choices: [{ message: { content: answer } }] }),
    { status: 200 }
  ))
}

function makeLLMStreamResponse(chunks: string[]) {
  const lines = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n`).join('')
  const done = 'data: [DONE]\n'
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines + done))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

const BASE_OPTS = {
  query: 'What is the capital of France?',
  className: 'Docs',
  topK: 5,
  embeddingConfig: EMBED_CONFIG,
  llmConfig: LLM_CONFIG,
  properties: ['content'],
  connectionConfig: null,
}

// ── semantic search path ──────────────────────────────────────────────────────

describe('runRAGQuery — semantic', () => {
  it('embeds query, retrieves sources, generates answer', async () => {
    vi.mocked(embedSingle).mockResolvedValue(TEST_VECTOR)
    vi.mocked(nearVectorSearch).mockResolvedValue(SOURCES)
    mockLLMNonStream('Paris.')

    const result = await runRAGQuery({ ...BASE_OPTS, searchType: 'semantic' })

    expect(embedSingle).toHaveBeenCalledWith(BASE_OPTS.query, EMBED_CONFIG)
    expect(nearVectorSearch).toHaveBeenCalledWith(
      expect.objectContaining({ className: 'Docs', vector: TEST_VECTOR, limit: 5 })
    )
    expect(result.answer).toBe('Paris.')
    expect(result.sources).toHaveLength(2)
    expect(result.context).toContain('City of Light')
  })

  it('fires onStep callbacks in order: embedding → retrieving → generating', async () => {
    vi.mocked(embedSingle).mockResolvedValue(TEST_VECTOR)
    vi.mocked(nearVectorSearch).mockResolvedValue(SOURCES)
    mockLLMNonStream('Answer')

    const steps: string[] = []
    await runRAGQuery({ ...BASE_OPTS, searchType: 'semantic', onStep: (s) => steps.push(s) })

    expect(steps).toEqual(['embedding', 'retrieving', 'generating'])
  })

  it('context is formatted with source numbers and scores', async () => {
    vi.mocked(embedSingle).mockResolvedValue(TEST_VECTOR)
    vi.mocked(nearVectorSearch).mockResolvedValue(SOURCES)
    mockLLMNonStream('Done')

    const result = await runRAGQuery({ ...BASE_OPTS, searchType: 'semantic' })
    expect(result.context).toContain('[Source 1]')
    expect(result.context).toContain('[Source 2]')
    expect(result.context).toContain('score: 0.9000')
  })

  it('throws when embedding fails', async () => {
    vi.mocked(embedSingle).mockRejectedValue(new Error('Cannot reach Ollama'))
    await expect(runRAGQuery({ ...BASE_OPTS, searchType: 'semantic' }))
      .rejects.toThrow(/Embedding failed/)
  })

  it('throws when LLM call fails', async () => {
    vi.mocked(embedSingle).mockResolvedValue(TEST_VECTOR)
    vi.mocked(nearVectorSearch).mockResolvedValue([])
    mockFetch.mockResolvedValue(new Response('', { status: 500 }))
    await expect(runRAGQuery({ ...BASE_OPTS, searchType: 'semantic' }))
      .rejects.toThrow(/LLM generation failed/)
  })
})

// ── bm25 search path ──────────────────────────────────────────────────────────

describe('runRAGQuery — bm25', () => {
  it('does NOT call embedSingle, calls bm25Search', async () => {
    vi.mocked(bm25Search).mockResolvedValue(SOURCES)
    mockLLMNonStream('Answer')

    await runRAGQuery({ ...BASE_OPTS, searchType: 'bm25' })

    expect(embedSingle).not.toHaveBeenCalled()
    expect(bm25Search).toHaveBeenCalledWith(
      expect.objectContaining({ className: 'Docs', query: BASE_OPTS.query, limit: 5 })
    )
  })

  it('fires onStep: retrieving then generating (no embedding step)', async () => {
    vi.mocked(bm25Search).mockResolvedValue([])
    mockLLMNonStream('Done')

    const steps: string[] = []
    await runRAGQuery({ ...BASE_OPTS, searchType: 'bm25', onStep: (s) => steps.push(s) })
    expect(steps).toEqual(['retrieving', 'generating'])
  })
})

// ── hybrid search path ────────────────────────────────────────────────────────

describe('runRAGQuery — hybrid', () => {
  it('attempts embedding, then calls hybridSearch with vector', async () => {
    vi.mocked(embedSingle).mockResolvedValue(TEST_VECTOR)
    vi.mocked(hybridSearch).mockResolvedValue(SOURCES)
    mockLLMNonStream('Hybrid answer')

    await runRAGQuery({ ...BASE_OPTS, searchType: 'hybrid', alpha: 0.75 })

    expect(hybridSearch).toHaveBeenCalledWith(
      expect.objectContaining({ vector: TEST_VECTOR, alpha: 0.75 })
    )
  })

  it('falls back to hybrid without vector when embedding fails', async () => {
    vi.mocked(embedSingle).mockRejectedValue(new Error('No GPU'))
    vi.mocked(hybridSearch).mockResolvedValue(SOURCES)
    mockLLMNonStream('Keyword-only answer')

    await runRAGQuery({ ...BASE_OPTS, searchType: 'hybrid' })

    expect(hybridSearch).toHaveBeenCalledWith(
      expect.objectContaining({ vector: undefined })
    )
  })

  it('fires onStep: embedding → retrieving → generating (even when embedding fails)', async () => {
    vi.mocked(embedSingle).mockRejectedValue(new Error('fail'))
    vi.mocked(hybridSearch).mockResolvedValue([])
    mockLLMNonStream('OK')

    const steps: string[] = []
    await runRAGQuery({ ...BASE_OPTS, searchType: 'hybrid', onStep: (s) => steps.push(s) })
    expect(steps).toContain('embedding')
    expect(steps).toContain('retrieving')
    expect(steps).toContain('generating')
  })

  it('passes alpha=0.5 when not specified', async () => {
    vi.mocked(embedSingle).mockResolvedValue(TEST_VECTOR)
    vi.mocked(hybridSearch).mockResolvedValue([])
    mockLLMNonStream('OK')

    await runRAGQuery({ ...BASE_OPTS, searchType: 'hybrid' })
    expect(hybridSearch).toHaveBeenCalledWith(expect.objectContaining({ alpha: 0.5 }))
  })
})

// ── LLM streaming ─────────────────────────────────────────────────────────────

describe('runRAGQuery — LLM streaming', () => {
  it('accumulates streamed chunks via onChunk callback', async () => {
    vi.mocked(bm25Search).mockResolvedValue(SOURCES)
    mockFetch.mockResolvedValue(makeLLMStreamResponse(['Par', 'is', ' is great.']))

    const chunks: string[] = []
    const result = await runRAGQuery({
      ...BASE_OPTS,
      searchType: 'bm25',
      onChunk: (c) => chunks.push(c),
    })

    expect(chunks).toEqual(['Par', 'is', ' is great.'])
    expect(result.answer).toBe('Paris is great.')
  })
})

// ── Ollama LLM path ───────────────────────────────────────────────────────────

describe('runRAGQuery — Ollama LLM', () => {
  const ollamaLLM: LLMConfig = { provider: 'ollama', model: 'llama3.2:3b' }

  it('calls /api/ollama/api/chat for Ollama provider', async () => {
    vi.mocked(bm25Search).mockResolvedValue([])
    mockFetch.mockResolvedValue(new Response(
      JSON.stringify({ message: { content: 'Ollama reply' } }),
      { status: 200 }
    ))

    const result = await runRAGQuery({ ...BASE_OPTS, searchType: 'bm25', llmConfig: ollamaLLM })
    expect(result.answer).toBe('Ollama reply')
    expect(mockFetch.mock.calls[0][0]).toContain('/api/chat')
  })

  it('throws with Ollama hint on network failure', async () => {
    vi.mocked(bm25Search).mockResolvedValue([])
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(runRAGQuery({ ...BASE_OPTS, searchType: 'bm25', llmConfig: ollamaLLM }))
      .rejects.toThrow(/LLM generation failed/)
  })
})

// ── context formatting ────────────────────────────────────────────────────────

describe('runRAGQuery — context formatting', () => {
  it('uses JSON.stringify for properties without content field', async () => {
    const sourcesNoContent: SearchResult[] = [
      { id: 'x', score: 0.5, class: 'Docs', properties: { title: 'My Doc', year: 2024 } },
    ]
    vi.mocked(bm25Search).mockResolvedValue(sourcesNoContent)
    mockLLMNonStream('OK')

    const result = await runRAGQuery({ ...BASE_OPTS, searchType: 'bm25' })
    expect(result.context).toContain('My Doc')
  })

  it('produces empty context when no sources retrieved', async () => {
    vi.mocked(bm25Search).mockResolvedValue([])
    mockLLMNonStream('I don\'t know')

    const result = await runRAGQuery({ ...BASE_OPTS, searchType: 'bm25' })
    expect(result.context).toBe('')
    expect(result.sources).toHaveLength(0)
  })
})
