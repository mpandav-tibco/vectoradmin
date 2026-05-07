/**
 * Unit tests for src/store/appStore.ts
 * Tests state mutations directly via Zustand's getState/setState APIs.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/store/appStore'
import type { RAGHistoryEntry, IngestRecord } from '@/types/domain'

function state() { return useAppStore.getState() }

const DEFAULT_EMBEDDING = { provider: 'ollama' as const, baseURL: '', model: 'nomic-embed-text' }
const DEFAULT_LLM = { provider: 'ollama' as const, baseURL: '', model: 'llama3.2:3b', temperature: 0.7, maxTokens: 1024 }

function makeRagEntry(id: string): RAGHistoryEntry {
  return {
    id,
    timestamp: Date.now(),
    query: `query-${id}`,
    answer: `answer-${id}`,
    sources: [],
    collectionName: 'test',
    searchType: 'hybrid',
    topK: 5,
  }
}

function makeIngestRecord(id: string, status: IngestRecord['status'] = 'running'): IngestRecord {
  return {
    id, timestamp: Date.now(), className: 'docs',
    fileNames: ['file.pdf'], status,
    chunks: 0, succeeded: 0, failed: 0,
  }
}

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({
    selectedCollection: null,
    vizHighlight: null,
    searchType: 'hybrid',
    alpha: 0.5,
    topK: 10,
    embeddingConfig: DEFAULT_EMBEDDING,
    llmConfig: DEFAULT_LLM,
    chunkConfig: { strategy: 'paragraph', size: 512, overlap: 64 },
    ragHistory: [],
    ingestHistory: [],
  })
})

// ── embedding config ───────────────────────────────────────────────────────────

describe('appStore.setEmbeddingConfig', () => {
  it('replaces embeddingConfig', () => {
    state().setEmbeddingConfig({ provider: 'openai', apiKey: 'sk-test', model: 'text-embedding-3-small' })
    expect(state().embeddingConfig.provider).toBe('openai')
    expect(state().embeddingConfig.apiKey).toBe('sk-test')
    expect(state().embeddingConfig.model).toBe('text-embedding-3-small')
  })
})

// ── LLM config ────────────────────────────────────────────────────────────────

describe('appStore.setLLMConfig', () => {
  it('replaces llmConfig', () => {
    state().setLLMConfig({ provider: 'openai', apiKey: 'sk-llm', model: 'gpt-4o', temperature: 0.2, maxTokens: 2048 })
    expect(state().llmConfig.provider).toBe('openai')
    expect(state().llmConfig.model).toBe('gpt-4o')
    expect(state().llmConfig.temperature).toBe(0.2)
  })
})

// ── chunk config ──────────────────────────────────────────────────────────────

describe('appStore.setChunkConfig', () => {
  it('replaces chunkConfig', () => {
    state().setChunkConfig({ strategy: 'sentence', size: 256, overlap: 32 })
    expect(state().chunkConfig.strategy).toBe('sentence')
    expect(state().chunkConfig.size).toBe(256)
    expect(state().chunkConfig.overlap).toBe(32)
  })
})

// ── search preferences ────────────────────────────────────────────────────────

describe('appStore search preferences', () => {
  it('setSearchType updates searchType', () => {
    state().setSearchType('bm25')
    expect(state().searchType).toBe('bm25')
  })

  it('setAlpha updates alpha', () => {
    state().setAlpha(0.8)
    expect(state().alpha).toBe(0.8)
  })

  it('setTopK updates topK', () => {
    state().setTopK(20)
    expect(state().topK).toBe(20)
  })
})

// ── RAG history ───────────────────────────────────────────────────────────────

describe('appStore.addRAGHistory', () => {
  it('prepends new entries so most recent is first', () => {
    const a = makeRagEntry('a')
    const b = makeRagEntry('b')
    state().addRAGHistory(a)
    state().addRAGHistory(b)
    expect(state().ragHistory[0].id).toBe('b')
    expect(state().ragHistory[1].id).toBe('a')
  })

  it('caps history at 20 entries', () => {
    for (let i = 0; i < 25; i++) state().addRAGHistory(makeRagEntry(String(i)))
    expect(state().ragHistory).toHaveLength(20)
  })

  it('preserves the most recent entries when cap is reached', () => {
    for (let i = 0; i < 22; i++) state().addRAGHistory(makeRagEntry(String(i)))
    // Most recent is id '21', oldest kept is id '2' (22 - 20 = 2 dropped)
    expect(state().ragHistory[0].id).toBe('21')
    expect(state().ragHistory[19].id).toBe('2')
  })
})

describe('appStore.clearRAGHistory', () => {
  it('empties ragHistory', () => {
    state().addRAGHistory(makeRagEntry('x'))
    state().clearRAGHistory()
    expect(state().ragHistory).toHaveLength(0)
  })
})

// ── ingest history ────────────────────────────────────────────────────────────

describe('appStore.startIngestJob', () => {
  it('prepends a new record with status running and zero counts', () => {
    state().startIngestJob({ id: 'job-1', timestamp: 1000, className: 'docs', fileNames: ['a.pdf'], status: 'running' })
    const r = state().ingestHistory[0]
    expect(r.id).toBe('job-1')
    expect(r.status).toBe('running')
    expect(r.chunks).toBe(0)
    expect(r.succeeded).toBe(0)
    expect(r.failed).toBe(0)
  })

  it('caps history at 30 entries', () => {
    for (let i = 0; i < 35; i++) {
      state().startIngestJob({ id: String(i), timestamp: i, className: 'c', fileNames: [], status: 'running' })
    }
    expect(state().ingestHistory).toHaveLength(30)
  })
})

describe('appStore.updateIngestJob', () => {
  it('patches the matching record by id', () => {
    state().startIngestJob({ id: 'j1', timestamp: 0, className: 'c', fileNames: [], status: 'running' })
    state().updateIngestJob('j1', { status: 'done', chunks: 42, succeeded: 40, failed: 2, duration: 5000 })
    const r = state().ingestHistory[0]
    expect(r.status).toBe('done')
    expect(r.chunks).toBe(42)
    expect(r.succeeded).toBe(40)
    expect(r.failed).toBe(2)
    expect(r.duration).toBe(5000)
  })

  it('only updates the targeted record', () => {
    state().startIngestJob({ id: 'j1', timestamp: 0, className: 'c', fileNames: [], status: 'running' })
    state().startIngestJob({ id: 'j2', timestamp: 1, className: 'c', fileNames: [], status: 'running' })
    state().updateIngestJob('j1', { status: 'error', errorMessage: 'failed' })
    expect(state().ingestHistory.find((r) => r.id === 'j1')?.status).toBe('error')
    expect(state().ingestHistory.find((r) => r.id === 'j2')?.status).toBe('running')
  })

  it('is a no-op for unknown id', () => {
    state().startIngestJob({ id: 'j1', timestamp: 0, className: 'c', fileNames: [], status: 'running' })
    state().updateIngestJob('unknown', { status: 'done' })
    expect(state().ingestHistory[0].status).toBe('running')
  })
})

describe('appStore.clearIngestHistory', () => {
  it('empties ingestHistory', () => {
    state().startIngestJob({ id: 'j1', timestamp: 0, className: 'c', fileNames: [], status: 'running' })
    state().clearIngestHistory()
    expect(state().ingestHistory).toHaveLength(0)
  })
})

// ── partialize (localStorage) ─────────────────────────────────────────────────

describe('appStore partialize (localStorage)', () => {
  it('persists embeddingConfig including apiKey', () => {
    state().setEmbeddingConfig({ provider: 'openai', apiKey: 'sk-secret', model: 'text-embedding-3-small' })
    const stored = JSON.parse(localStorage.getItem('vector-admin-app') ?? '{}')
    expect(stored.state?.embeddingConfig?.apiKey).toBe('sk-secret')
    expect(stored.state?.embeddingConfig?.provider).toBe('openai')
  })

  it('persists llmConfig including apiKey', () => {
    state().setLLMConfig({ provider: 'openai', apiKey: 'sk-llm', model: 'gpt-4o' })
    const stored = JSON.parse(localStorage.getItem('vector-admin-app') ?? '{}')
    expect(stored.state?.llmConfig?.apiKey).toBe('sk-llm')
  })

  it('persists chunkConfig', () => {
    state().setChunkConfig({ strategy: 'sentence', size: 128, overlap: 16 })
    const stored = JSON.parse(localStorage.getItem('vector-admin-app') ?? '{}')
    expect(stored.state?.chunkConfig?.strategy).toBe('sentence')
    expect(stored.state?.chunkConfig?.size).toBe(128)
  })

  it('persists search preferences', () => {
    state().setSearchType('bm25')
    state().setAlpha(0.75)
    state().setTopK(15)
    const stored = JSON.parse(localStorage.getItem('vector-admin-app') ?? '{}')
    expect(stored.state?.searchType).toBe('bm25')
    expect(stored.state?.alpha).toBe(0.75)
    expect(stored.state?.topK).toBe(15)
  })

  it('persists ragHistory', () => {
    state().addRAGHistory(makeRagEntry('r1'))
    const stored = JSON.parse(localStorage.getItem('vector-admin-app') ?? '{}')
    expect(stored.state?.ragHistory).toHaveLength(1)
    expect(stored.state?.ragHistory[0].id).toBe('r1')
  })

  it('does NOT persist vizHighlight (ephemeral)', () => {
    state().setVizHighlight({ collectionName: 'docs', ids: ['id-1', 'id-2'] })
    const stored = JSON.parse(localStorage.getItem('vector-admin-app') ?? '{}')
    expect(stored.state?.vizHighlight).toBeUndefined()
  })

  it('does NOT persist selectedCollection (ephemeral)', () => {
    state().setSelectedCollection('my-collection')
    const stored = JSON.parse(localStorage.getItem('vector-admin-app') ?? '{}')
    expect(stored.state?.selectedCollection).toBeUndefined()
  })
})
