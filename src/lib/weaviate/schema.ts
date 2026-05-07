import { weaviateApi } from './client'
import type { WeaviateCollection } from '@/types/domain'
import type { ConnectionConfig } from '@/types/domain'

interface SchemaResponse {
  classes: WeaviateCollection[]
}

export async function listCollections(config?: ConnectionConfig | null): Promise<WeaviateCollection[]> {
  const resp = await weaviateApi.get<SchemaResponse>('/v1/schema', config)
  return resp.classes ?? []
}

export async function getCollection(name: string, config?: ConnectionConfig | null): Promise<WeaviateCollection> {
  return weaviateApi.get<WeaviateCollection>(`/v1/schema/${name}`, config)
}

export async function createCollection(
  collection: Partial<WeaviateCollection>,
  config?: ConnectionConfig | null
): Promise<WeaviateCollection> {
  return weaviateApi.post<WeaviateCollection>('/v1/schema', collection, config)
}

export async function deleteCollection(name: string, config?: ConnectionConfig | null): Promise<void> {
  await weaviateApi.delete(`/v1/schema/${name}`, config)
}

export async function getObjectCount(className: string, config?: ConnectionConfig | null): Promise<number> {
  const resp = await weaviateApi.post<{
    data: { Aggregate: Record<string, [{ meta: { count: number } }]> }
  }>(
    '/v1/graphql',
    { query: `{ Aggregate { ${className} { meta { count } } } }` },
    config
  )
  return resp.data?.Aggregate?.[className]?.[0]?.meta?.count ?? 0
}
