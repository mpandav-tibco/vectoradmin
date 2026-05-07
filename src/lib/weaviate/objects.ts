import { weaviateApi } from './client'
import type { WeaviateObject } from '@/types/domain'
import type { ConnectionConfig } from '@/types/domain'

interface ObjectsResponse {
  objects: WeaviateObject[]
  totalResults?: number
}

export async function listObjects(
  className: string,
  opts: { limit?: number; offset?: number; includeVector?: boolean } = {},
  config?: ConnectionConfig | null
): Promise<{ objects: WeaviateObject[]; total: number }> {
  const params = new URLSearchParams({
    class: className,
    limit: String(opts.limit ?? 25),
    offset: String(opts.offset ?? 0),
  })
  if (opts.includeVector) params.set('include', 'vector')

  const resp = await weaviateApi.get<ObjectsResponse>(`/v1/objects?${params}`, config)
  return { objects: resp.objects ?? [], total: resp.totalResults ?? 0 }
}

export async function getObject(
  className: string,
  id: string,
  includeVector = true,
  config?: ConnectionConfig | null
): Promise<WeaviateObject> {
  const path = `/v1/objects/${className}/${id}${includeVector ? '?include=vector' : ''}`
  return weaviateApi.get<WeaviateObject>(path, config)
}

export async function createObject(
  obj: { class: string; properties: Record<string, unknown>; id?: string; vector?: number[] },
  config?: ConnectionConfig | null
): Promise<WeaviateObject> {
  return weaviateApi.post<WeaviateObject>('/v1/objects', obj, config)
}

export async function updateObject(
  className: string,
  id: string,
  properties: Record<string, unknown>,
  config?: ConnectionConfig | null
): Promise<WeaviateObject> {
  return weaviateApi.patch<WeaviateObject>(`/v1/objects/${className}/${id}`, { properties }, config)
}

export async function deleteObject(
  className: string,
  id: string,
  config?: ConnectionConfig | null
): Promise<void> {
  await weaviateApi.delete(`/v1/objects/${className}/${id}`, config)
}

export async function batchUpsert(
  objects: Array<{ class: string; properties: Record<string, unknown>; id?: string; vector?: number[] }>,
  config?: ConnectionConfig | null
): Promise<{ success: number; errors: string[] }> {
  const resp = await weaviateApi.post<Array<{ id?: string; result?: { errors?: { error: Array<{ message: string }> } } }>>(
    '/v1/batch/objects',
    { objects },
    config
  )
  const errors: string[] = []
  let success = 0
  for (const r of resp) {
    if (r.result?.errors?.error?.length) {
      errors.push(...r.result.errors.error.map((e) => e.message))
    } else {
      success++
    }
  }
  return { success, errors }
}
