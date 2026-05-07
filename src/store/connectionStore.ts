import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConnectionConfig, EmbeddingConfig, LLMConfig } from '@/types/domain'

type Status = 'idle' | 'connecting' | 'connected' | 'error'

export interface SavedConnection extends ConnectionConfig {
  label: string
  embeddingConfig?: EmbeddingConfig
  llmConfig?: LLMConfig
}

interface ConnectionStore {
  config: ConnectionConfig | null
  status: Status
  error: string | null
  version: string | null
  savedConnections: SavedConnection[]
  setConfig: (config: ConnectionConfig) => void
  setStatus: (status: Status, error?: string, version?: string) => void
  disconnect: () => void
  saveConnection: (config: ConnectionConfig, label?: string) => void
  updateConnection: (idx: number, patch: Partial<SavedConnection>) => void
  deleteConnection: (idx: number) => void
}

export const useConnectionStore = create<ConnectionStore>()(
  persist(
    (set) => ({
      config: null,
      status: 'idle',
      error: null,
      version: null,
      savedConnections: [],
      setConfig: (config) => set({ config, status: 'connecting', error: null }),
      setStatus: (status, error, version) => set({ status, error: error ?? null, version: version ?? null }),
      disconnect: () => set({ config: null, status: 'idle', error: null, version: null }),
      saveConnection: (config, label) =>
        set((s) => {
          const entry: SavedConnection = {
            ...config,
            label: label?.trim() || `${config.dbType} @ ${config.host}:${config.port}`,
          }
          const idx = s.savedConnections.findIndex(
            (c) => c.dbType === config.dbType && c.host === config.host && c.port === config.port
          )
          const updated = [...s.savedConnections]
          // Preserve embeddingConfig/llmConfig from existing entry when re-saving connection details
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], ...entry }
          } else {
            updated.push(entry)
          }
          return { savedConnections: updated }
        }),
      updateConnection: (idx, patch) =>
        set((s) => ({
          savedConnections: s.savedConnections.map((c, i) => i === idx ? { ...c, ...patch } : c),
        })),
      deleteConnection: (idx) =>
        set((s) => ({ savedConnections: s.savedConnections.filter((_, i) => i !== idx) })),
    }),
    {
      name: 'vector-admin-connection',
      partialize: (state: ConnectionStore) => ({ config: state.config, savedConnections: state.savedConnections }),
    }
  )
)
