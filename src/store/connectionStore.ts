import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConnectionConfig } from '@/types/domain'

type Status = 'idle' | 'connecting' | 'connected' | 'error'

interface ConnectionStore {
  config: ConnectionConfig | null
  status: Status
  error: string | null
  version: string | null
  setConfig: (config: ConnectionConfig) => void
  setStatus: (status: Status, error?: string, version?: string) => void
  disconnect: () => void
}

export const useConnectionStore = create<ConnectionStore>()(
  persist(
    (set) => ({
      config: null,
      status: 'idle',
      error: null,
      version: null,
      setConfig: (config) => set({ config, status: 'connecting', error: null }),
      setStatus: (status, error, version) => set({ status, error: error ?? null, version: version ?? null }),
      disconnect: () => set({ config: null, status: 'idle', error: null, version: null }),
    }),
    {
      name: 'vector-admin-connection',
      partialize: (state: ConnectionStore) => ({ config: state.config }),
    }
  )
)
