import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EmbeddingConfig, LLMConfig, RAGHistoryEntry, SearchType, ChunkConfig, IngestRecord } from '@/types/domain'

export interface VizHighlight { collectionName: string; ids: string[] }

export interface SearchLogEntry {
  id: string
  timestamp: number
  collectionName: string
  query: string
  searchType: string
  resultCount: number
  topScore?: number
  durationMs: number
}

interface AppStore {
  theme: 'dark' | 'light'
  setTheme: (theme: 'dark' | 'light') => void

  selectedCollection: string | null
  setSelectedCollection: (name: string | null) => void

  vizHighlight: VizHighlight | null
  setVizHighlight: (h: VizHighlight | null) => void

  searchType: SearchType
  setSearchType: (type: SearchType) => void
  alpha: number
  setAlpha: (v: number) => void
  topK: number
  setTopK: (v: number) => void

  embeddingConfig: EmbeddingConfig
  setEmbeddingConfig: (config: EmbeddingConfig) => void

  llmConfig: LLMConfig
  setLLMConfig: (config: LLMConfig) => void

  chunkConfig: ChunkConfig
  setChunkConfig: (config: ChunkConfig) => void

  ragHistory: RAGHistoryEntry[]
  addRAGHistory: (entry: RAGHistoryEntry) => void
  clearRAGHistory: () => void

  ingestHistory: IngestRecord[]
  startIngestJob: (record: Omit<IngestRecord, 'chunks' | 'succeeded' | 'failed'>) => void
  updateIngestJob: (id: string, patch: Partial<IngestRecord>) => void
  clearIngestHistory: () => void

  searchLog: SearchLogEntry[]
  addSearchLog: (entry: Omit<SearchLogEntry, 'id'>) => void
  clearSearchLog: () => void
}

const defaultEmbedding: EmbeddingConfig = {
  provider: 'ollama',
  baseURL: '',
  model: 'nomic-embed-text',
}

const defaultLLM: LLMConfig = {
  provider: 'ollama',
  baseURL: '',
  model: 'llama3.2:3b',
  temperature: 0.7,
  maxTokens: 1024,
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),

      selectedCollection: null,
      setSelectedCollection: (name) => set({ selectedCollection: name }),

      vizHighlight: null,
      setVizHighlight: (h) => set({ vizHighlight: h }),

      searchType: 'hybrid',
      setSearchType: (type) => set({ searchType: type }),
      alpha: 0.5,
      setAlpha: (v) => set({ alpha: v }),
      topK: 10,
      setTopK: (v) => set({ topK: v }),

      embeddingConfig: defaultEmbedding,
      setEmbeddingConfig: (config) => set({ embeddingConfig: config }),

      llmConfig: defaultLLM,
      setLLMConfig: (config) => set({ llmConfig: config }),

      chunkConfig: { strategy: 'paragraph', size: 512, overlap: 64 },
      setChunkConfig: (config) => set({ chunkConfig: config }),

      ragHistory: [],
      addRAGHistory: (entry) =>
        set((s) => ({
          ragHistory: [
            { ...entry, sources: entry.sources.map(({ vector: _v, ...rest }) => rest) },
            ...s.ragHistory,
          ].slice(0, 20),
        })),
      clearRAGHistory: () => set({ ragHistory: [] }),

      ingestHistory: [],
      startIngestJob: (record) =>
        set((s) => ({
          ingestHistory: [
            { ...record, chunks: 0, succeeded: 0, failed: 0 },
            ...s.ingestHistory,
          ].slice(0, 30),
        })),
      updateIngestJob: (id, patch) =>
        set((s) => ({
          ingestHistory: s.ingestHistory.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),
      clearIngestHistory: () => set({ ingestHistory: [] }),

      searchLog: [],
      addSearchLog: (entry) =>
        set((s) => ({
          searchLog: [
            { ...entry, id: crypto.randomUUID() },
            ...s.searchLog,
          ].slice(0, 200),
        })),
      clearSearchLog: () => set({ searchLog: [] }),
    }),
    {
      name: 'vector-admin-app',
      version: 1,
      partialize: (state) => ({
        theme:           state.theme,
        searchType:      state.searchType,
        alpha:           state.alpha,
        topK:            state.topK,
        embeddingConfig: state.embeddingConfig,
        llmConfig:       state.llmConfig,
        chunkConfig:     state.chunkConfig,
        ragHistory:      state.ragHistory,
        ingestHistory:   state.ingestHistory,
        // searchLog intentionally excluded — session only
      }),
    }
  )
)
