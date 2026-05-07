import { weaviateApi } from './client'
import type { ConnectionConfig } from '@/types/domain'

export interface HealthStatus {
  ready: boolean
  live: boolean
  version?: string
  error?: string
}

export async function checkHealth(config?: ConnectionConfig | null): Promise<HealthStatus> {
  try {
    await weaviateApi.get('/v1/.well-known/ready', config)
    const meta = await weaviateApi.get<{ version: string }>('/v1/meta', config)
    return { ready: true, live: true, version: meta.version }
  } catch (err) {
    return {
      ready: false,
      live: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
