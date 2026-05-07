import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EmbeddingConfig, LLMConfig, RAGHistoryEntry, SearchType, ChunkConfig } from '@/types/domain'

export interface VizHighlight { collectionName: string; ids: string[] }

interface AppStore {
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
        set((s) => ({ ragHistory: [entry, ...s.ragHistory].slice(0, 20) })),
      clearRAGHistory: () => set({ ragHistory: [] }),
    }),
    { name: 'vector-admin-app' }
  )
)
