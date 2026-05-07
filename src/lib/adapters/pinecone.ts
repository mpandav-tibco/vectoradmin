import { buildBaseURL } from '@/lib/weaviate/client'
import type { ConnectionConfig, SearchResult } from '@/types/domain'
import type { DBAdapter, DBCollection, DBObject, DBHealthStatus, CreateCollectionInput, BatchResult } from './types'

interface PineconeStats {
  dimension: number
  index_fullness: number
  total_vector_count: number
  namespaces: Record<string, { vector_count: number }>
}

interface PineconeMatch {
  id: string
  score: number
  values?: number[]
  metadata?: Record<string, unknown>
}

export class PineconeAdapter implements DBAdapter {
  private baseURL: string
  private headers: Record<string, string>
  private dimension = 0  // cached from describe_index_stats

  constructor(private config: ConnectionConfig) {
    this.baseURL = buildBaseURL(config)
    this.headers = {
      'Content-Type': 'application/json',
      'Api-Key': config.apiKey ?? '',
    }
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseURL}${path}`, {
      ...init,
      headers: { ...this.headers, ...((init?.headers as Record<string, string>) ?? {}) },
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try { msg = (JSON.parse(text) as { message?: string }).message ?? msg } catch {}
      throw new Error(msg)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(`Pinecone returned non-JSON (HTTP ${res.status}) — check host, port and proxy settings`)
    }
  }

  private async getStats(): Promise<PineconeStats> {
    const stats = await this.req<PineconeStats>('/describe_index_stats', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    this.dimension = stats.dimension
    return stats
  }

  async checkHealth(): Promise<DBHealthStatus> {
    try {
      const stats = await this.getStats()
      return { ready: true, version: `${stats.dimension}d` }
    } catch (e) {
      return { ready: false, error: e instanceof Error ? e.message : 'Connection failed' }
    }
  }

  async listCollections(): Promise<DBCollection[]> {
    const stats = await this.getStats()
    const namespaces = Object.entries(stats.namespaces ?? {})
    if (namespaces.length === 0) {
      return [{ name: '', objectCount: stats.total_vector_count, vectorDimensions: stats.dimension, description: 'Default namespace' }]
    }
    return namespaces.map(([ns, info]) => ({
      name: ns,
      objectCount: info.vector_count,
      vectorDimensions: stats.dimension,
    }))
  }

  async getCollection(name: string): Promise<DBCollection> {
    const stats = await this.getStats()
    const ns = name
    const count = ns === '' ? stats.total_vector_count : (stats.namespaces?.[ns]?.vector_count ?? 0)
    return { name, objectCount: count, vectorDimensions: stats.dimension }
  }

  async createCollection(_input: CreateCollectionInput): Promise<void> {
    // Pinecone namespaces are created implicitly on first write — nothing to do here.
    // The index itself must be created through the Pinecone console or control plane API.
  }

  async deleteCollection(name: string): Promise<void> {
    await this.req('/vectors/delete', {
      method: 'POST',
      body: JSON.stringify({ delete_all: true, namespace: name }),
    })
  }

  async getObjectCount(name: string): Promise<number> {
    const stats = await this.getStats()
    if (name === '') return stats.total_vector_count
    return stats.namespaces?.[name]?.vector_count ?? 0
  }

  async listObjects(collection: string, limit: number, _offset: number): Promise<{ objects: DBObject[]; total: number }> {
    const total = await this.getObjectCount(collection)
    try {
      // /vectors/list is serverless-only; gracefully degrade for pod-based indexes
      const listData = await this.req<{ vectors: Array<{ id: string }> }>(
        `/vectors/list?namespace=${encodeURIComponent(collection)}&limit=${limit}`
      )
      const ids = (listData.vectors ?? []).map((v) => v.id)
      if (ids.length === 0) return { objects: [], total }

      const qs = ids.map((id) => `ids=${encodeURIComponent(id)}`).join('&')
      const fetchData = await this.req<{
        vectors: Record<string, { id: string; values?: number[]; metadata?: Record<string, unknown> }>
      }>(`/vectors/fetch?${qs}&namespace=${encodeURIComponent(collection)}`)

      const objects = Object.values(fetchData.vectors ?? {}).map((v) => ({
        id: v.id,
        properties: v.metadata ?? {},
        vector: v.values,
        class: collection,
      }))
      return { objects, total }
    } catch {
      // Pod-based index or other error — list not supported
      return { objects: [], total }
    }
  }

  async createObject(collection: string, properties: Record<string, unknown>, vector?: number[]): Promise<string> {
    const id = crypto.randomUUID()
    const dim = this.dimension || 1536
    await this.req('/vectors/upsert', {
      method: 'POST',
      body: JSON.stringify({
        vectors: [{ id, values: vector ?? new Array(dim).fill(0), metadata: properties }],
        namespace: collection,
      }),
    })
    return id
  }

  async deleteObject(collection: string, id: string): Promise<void> {
    await this.req('/vectors/delete', {
      method: 'POST',
      body: JSON.stringify({ ids: [id], namespace: collection }),
    })
  }

  async vectorSearch(collection: string, vector: number[], limit: number): Promise<SearchResult[]> {
    const data = await this.req<{ matches: PineconeMatch[] }>('/query', {
      method: 'POST',
      body: JSON.stringify({ vector, topK: limit, includeMetadata: true, namespace: collection }),
    })
    return (data.matches ?? []).map((m) => ({
      id: m.id,
      score: m.score,
      class: collection,
      properties: m.metadata ?? {},
      vector: m.values,
    }))
  }

  async keywordSearch(collection: string, query: string, limit: number): Promise<SearchResult[]> {
    // Pinecone has no native full-text search — fetch a broad result set with a zero vector
    // and filter client-side by metadata text content.
    const dim = this.dimension || 1536
    const data = await this.req<{ matches: PineconeMatch[] }>('/query', {
      method: 'POST',
      body: JSON.stringify({
        vector: new Array(dim).fill(0),
        topK: Math.min(limit * 20, 10000),
        includeMetadata: true,
        namespace: collection,
      }),
    })
    const q = query.toLowerCase()
    return (data.matches ?? [])
      .filter((m) => Object.values(m.metadata ?? {}).some((v) => String(v).toLowerCase().includes(q)))
      .slice(0, limit)
      .map((m, i) => ({ id: m.id, score: 1 - i * 0.01, class: collection, properties: m.metadata ?? {} }))
  }

  async hybridSearch(collection: string, query: string, vector: number[] | undefined, _alpha: number, limit: number): Promise<SearchResult[]> {
    if (vector) return this.vectorSearch(collection, vector, limit)
    return this.keywordSearch(collection, query, limit)
  }

  async batchInsert(collection: string, objects: Array<{ id?: string; properties: Record<string, unknown>; vector?: number[] }>): Promise<BatchResult> {
    try {
      const dim = this.dimension || 1536
      const vectors = objects.map((o) => ({
        id: o.id ?? crypto.randomUUID(),
        values: o.vector ?? new Array(dim).fill(0),
        metadata: o.properties,
      }))
      // Pinecone recommends max 100 vectors per upsert
      const BATCH = 100
      for (let i = 0; i < vectors.length; i += BATCH) {
        await this.req('/vectors/upsert', {
          method: 'POST',
          body: JSON.stringify({ vectors: vectors.slice(i, i + BATCH), namespace: collection }),
        })
      }
      return { success: objects.length, errors: [] }
    } catch (e) {
      return { success: 0, errors: [e instanceof Error ? e.message : 'Batch insert failed'] }
    }
  }
}
