import { buildBaseURL } from '@/lib/weaviate/client'
import type { ConnectionConfig, SearchResult } from '@/types/domain'
import type { DBAdapter, DBCollection, DBObject, DBHealthStatus, CreateCollectionInput, BatchResult } from './types'

const DISTANCE_TO_QDRANT: Record<string, string> = {
  cosine: 'Cosine', dot: 'Dot', euclidean: 'Euclid', hamming: 'Manhattan',
}
const DISTANCE_FROM_QDRANT: Record<string, string> = {
  Cosine: 'cosine', Dot: 'dot', Euclid: 'euclidean', Manhattan: 'hamming',
}

type QdrantVectors = { size: number; distance: string } | Record<string, { size: number; distance: string }>

export class QdrantAdapter implements DBAdapter {
  private baseURL: string
  private headers: Record<string, string>

  constructor(private config: ConnectionConfig) {
    this.baseURL = buildBaseURL(config)
    this.headers = { 'Content-Type': 'application/json' }
    if (config.apiKey) this.headers['api-key'] = config.apiKey
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseURL}${path}`, {
      ...init,
      headers: { ...this.headers, ...((init?.headers as Record<string, string>) ?? {}) },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let msg = `HTTP ${res.status}`
      try { msg = (JSON.parse(text) as { status?: { error?: string } }).status?.error ?? msg } catch {}
      throw new Error(msg)
    }
    return res.json() as Promise<T>
  }

  async checkHealth(): Promise<DBHealthStatus> {
    try {
      const data = await this.req<{ title: string; version: string }>('/')
      return { ready: true, version: data.version }
    } catch (e) {
      return { ready: false, error: e instanceof Error ? e.message : 'Connection failed' }
    }
  }

  async listCollections(): Promise<DBCollection[]> {
    const data = await this.req<{ result: { collections: Array<{ name: string }> } }>('/collections')
    return data.result.collections.map((c) => ({ name: c.name }))
  }

  async getCollection(name: string): Promise<DBCollection> {
    const data = await this.req<{
      result: {
        points_count: number
        config: { params: { vectors: QdrantVectors } }
      }
    }>(`/collections/${name}`)
    const vecs = data.result.config.params.vectors
    const named = vecs as { size?: number; distance?: string } & Record<string, { size: number; distance: string }>
    const size: number = named.size ?? Object.values(named).find((v) => typeof v === 'object')?.size ?? 0
    const dist: string = named.distance ?? Object.values(named).find((v) => typeof v === 'object')?.distance ?? 'Cosine'
    return {
      name,
      vectorDimensions: size,
      distance: DISTANCE_FROM_QDRANT[dist] ?? dist.toLowerCase(),
      objectCount: data.result.points_count,
    }
  }

  async createCollection(input: CreateCollectionInput): Promise<void> {
    await this.req(`/collections/${input.name}`, {
      method: 'PUT',
      body: JSON.stringify({
        vectors: {
          size: input.vectorDimensions ?? 768,
          distance: DISTANCE_TO_QDRANT[input.distance ?? 'cosine'] ?? 'Cosine',
        },
      }),
    })
  }

  async deleteCollection(name: string): Promise<void> {
    await this.req(`/collections/${name}`, { method: 'DELETE' })
  }

  async getObjectCount(name: string): Promise<number> {
    const data = await this.req<{ result: { count: number } }>(`/collections/${name}/points/count`, {
      method: 'POST',
      body: JSON.stringify({ exact: true }),
    })
    return data.result.count
  }

  async listObjects(collection: string, limit: number, _offset: number): Promise<{ objects: DBObject[]; total: number }> {
    const data = await this.req<{
      result: { points: Array<{ id: string | number; payload?: Record<string, unknown>; vector?: number[] | null }> }
    }>(`/collections/${collection}/points/scroll`, {
      method: 'POST',
      body: JSON.stringify({ limit, with_payload: true, with_vector: true }),
    })
    const total = await this.getObjectCount(collection)
    return {
      objects: data.result.points.map((p) => ({
        id: String(p.id),
        properties: p.payload ?? {},
        vector: Array.isArray(p.vector) ? p.vector : undefined,
        class: collection,
      })),
      total,
    }
  }

  async createObject(collection: string, properties: Record<string, unknown>, vector?: number[]): Promise<string> {
    const id = crypto.randomUUID()
    await this.req(`/collections/${collection}/points?wait=true`, {
      method: 'PUT',
      body: JSON.stringify({ points: [{ id, vector: vector ?? [], payload: properties }] }),
    })
    return id
  }

  async deleteObject(collection: string, id: string): Promise<void> {
    await this.req(`/collections/${collection}/points/delete?wait=true`, {
      method: 'POST',
      body: JSON.stringify({ points: [id] }),
    })
  }

  async vectorSearch(collection: string, vector: number[], limit: number): Promise<SearchResult[]> {
    const data = await this.req<{
      result: Array<{ id: string | number; score: number; payload?: Record<string, unknown> }>
    }>(`/collections/${collection}/points/search`, {
      method: 'POST',
      body: JSON.stringify({ vector, limit, with_payload: true }),
    })
    return data.result.map((p) => ({
      id: String(p.id),
      score: p.score,
      class: collection,
      properties: p.payload ?? {},
    }))
  }

  async keywordSearch(collection: string, query: string, limit: number): Promise<SearchResult[]> {
    const data = await this.req<{
      result: { points: Array<{ id: string | number; payload?: Record<string, unknown> }> }
    }>(`/collections/${collection}/points/scroll`, {
      method: 'POST',
      body: JSON.stringify({
        limit,
        with_payload: true,
        filter: {
          should: [
            { key: 'content', match: { text: query } },
            { key: 'text', match: { text: query } },
            { key: 'title', match: { text: query } },
          ],
        },
      }),
    })
    return data.result.points.map((p, i) => ({
      id: String(p.id),
      score: 1 - i * 0.01,
      class: collection,
      properties: p.payload ?? {},
    }))
  }

  async hybridSearch(collection: string, query: string, vector: number[] | undefined, _alpha: number, limit: number): Promise<SearchResult[]> {
    if (vector) return this.vectorSearch(collection, vector, limit)
    return this.keywordSearch(collection, query, limit)
  }

  async batchInsert(collection: string, objects: Array<{ id?: string; properties: Record<string, unknown>; vector?: number[] }>): Promise<BatchResult> {
    try {
      const points = objects.map((o) => ({
        id: o.id ?? crypto.randomUUID(),
        vector: o.vector ?? [],
        payload: o.properties,
      }))
      await this.req(`/collections/${collection}/points?wait=true`, {
        method: 'PUT',
        body: JSON.stringify({ points }),
      })
      return { success: objects.length, errors: [] }
    } catch (e) {
      return { success: 0, errors: [e instanceof Error ? e.message : 'Batch insert failed'] }
    }
  }
}
