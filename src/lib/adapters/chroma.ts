import { buildBaseURL } from '@/lib/weaviate/client'
import type { ConnectionConfig, SearchResult } from '@/types/domain'
import type { DBAdapter, DBCollection, DBObject, DBHealthStatus, CreateCollectionInput, BatchResult } from './types'

const SPACE_TO_CHROMA: Record<string, string> = {
  cosine: 'cosine', dot: 'ip', euclidean: 'l2', hamming: 'l2',
}
const SPACE_FROM_CHROMA: Record<string, string> = {
  cosine: 'cosine', ip: 'dot', l2: 'euclidean',
}

interface ChromaCollection {
  id: string
  name: string
  metadata?: Record<string, string>
}

export class ChromaAdapter implements DBAdapter {
  private baseURL: string
  private headers: Record<string, string>

  constructor(private config: ConnectionConfig) {
    this.baseURL = buildBaseURL(config)
    this.headers = { 'Content-Type': 'application/json' }
    if (config.apiKey) this.headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseURL}${path}`, {
      ...init,
      headers: { ...this.headers, ...((init?.headers as Record<string, string>) ?? {}) },
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try { msg = (JSON.parse(text) as { detail?: string }).detail ?? msg } catch {}
      throw new Error(msg)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(`Chroma returned non-JSON (HTTP ${res.status}) — check host, port and proxy settings`)
    }
  }

  private async getCollectionId(name: string): Promise<string> {
    const col = await this.req<ChromaCollection>(`/api/v1/collections/${name}`)
    return col.id
  }

  async checkHealth(): Promise<DBHealthStatus> {
    try {
      await this.req('/api/v1')
      const version = await this.req<string>('/api/v1/version')
      return { ready: true, version: String(version).replace(/"/g, '') }
    } catch (e) {
      return { ready: false, error: e instanceof Error ? e.message : 'Connection failed' }
    }
  }

  async listCollections(): Promise<DBCollection[]> {
    const cols = await this.req<ChromaCollection[]>('/api/v1/collections')
    return cols.map((c) => ({
      name: c.name,
      description: c.metadata?.description,
      distance: SPACE_FROM_CHROMA[c.metadata?.['hnsw:space'] ?? 'cosine'] ?? 'cosine',
    }))
  }

  async getCollection(name: string): Promise<DBCollection> {
    const c = await this.req<ChromaCollection>(`/api/v1/collections/${name}`)
    const count = await this.req<number>(`/api/v1/collections/${c.id}/count`)
    return {
      name: c.name,
      description: c.metadata?.description,
      distance: SPACE_FROM_CHROMA[c.metadata?.['hnsw:space'] ?? 'cosine'] ?? 'cosine',
      objectCount: count,
    }
  }

  async createCollection(input: CreateCollectionInput): Promise<void> {
    await this.req('/api/v1/collections', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        metadata: {
          'hnsw:space': SPACE_TO_CHROMA[input.distance ?? 'cosine'] ?? 'cosine',
          ...(input.description ? { description: input.description } : {}),
        },
        get_or_create: false,
      }),
    })
  }

  async deleteCollection(name: string): Promise<void> {
    await this.req(`/api/v1/collections/${name}`, { method: 'DELETE' })
  }

  async getObjectCount(name: string): Promise<number> {
    const id = await this.getCollectionId(name)
    return this.req<number>(`/api/v1/collections/${id}/count`)
  }

  async listObjects(collection: string, limit: number, offset: number): Promise<{ objects: DBObject[]; total: number }> {
    const id = await this.getCollectionId(collection)
    const data = await this.req<{
      ids: string[]
      documents: string[]
      metadatas: Record<string, unknown>[]
      embeddings?: number[][]
    }>(`/api/v1/collections/${id}/get`, {
      method: 'POST',
      body: JSON.stringify({ limit, offset, include: ['documents', 'metadatas', 'embeddings'] }),
    })
    const total = await this.req<number>(`/api/v1/collections/${id}/count`)
    return {
      objects: (data.ids ?? []).map((docId, i) => ({
        id: docId,
        properties: {
          content: data.documents?.[i] ?? '',
          ...(data.metadatas?.[i] ?? {}),
        },
        vector: data.embeddings?.[i],
        class: collection,
      })),
      total,
    }
  }

  async createObject(collection: string, properties: Record<string, unknown>, vector?: number[]): Promise<string> {
    const id = await this.getCollectionId(collection)
    const docId = crypto.randomUUID()
    const { content, text, ...meta } = properties
    await this.req(`/api/v1/collections/${id}/add`, {
      method: 'POST',
      body: JSON.stringify({
        ids: [docId],
        documents: [String(content ?? text ?? '')],
        metadatas: [meta as Record<string, string | number | boolean>],
        ...(vector ? { embeddings: [vector] } : {}),
      }),
    })
    return docId
  }

  async deleteObject(collection: string, docId: string): Promise<void> {
    const id = await this.getCollectionId(collection)
    await this.req(`/api/v1/collections/${id}/delete`, {
      method: 'POST',
      body: JSON.stringify({ ids: [docId] }),
    })
  }

  async vectorSearch(collection: string, vector: number[], limit: number): Promise<SearchResult[]> {
    const id = await this.getCollectionId(collection)
    const data = await this.req<{
      ids: string[][]
      distances: number[][]
      documents: string[][]
      metadatas: Record<string, unknown>[][]
    }>(`/api/v1/collections/${id}/query`, {
      method: 'POST',
      body: JSON.stringify({
        query_embeddings: [vector],
        n_results: limit,
        include: ['documents', 'metadatas', 'distances'],
      }),
    })
    return (data.ids[0] ?? []).map((docId, i) => ({
      id: docId,
      score: Math.max(0, 1 - (data.distances[0]?.[i] ?? 0)),
      class: collection,
      properties: {
        content: data.documents[0]?.[i] ?? '',
        ...(data.metadatas[0]?.[i] ?? {}),
      },
    }))
  }

  async keywordSearch(collection: string, query: string, limit: number): Promise<SearchResult[]> {
    const id = await this.getCollectionId(collection)
    const data = await this.req<{
      ids: string[]
      documents: string[]
      metadatas: Record<string, unknown>[]
    }>(`/api/v1/collections/${id}/get`, {
      method: 'POST',
      body: JSON.stringify({
        limit,
        where_document: { $contains: query },
        include: ['documents', 'metadatas'],
      }),
    })
    return (data.ids ?? []).map((docId, i) => ({
      id: docId,
      score: 1,
      class: collection,
      properties: {
        content: data.documents?.[i] ?? '',
        ...(data.metadatas?.[i] ?? {}),
      },
    }))
  }

  async hybridSearch(collection: string, query: string, vector: number[] | undefined, _alpha: number, limit: number): Promise<SearchResult[]> {
    if (vector) return this.vectorSearch(collection, vector, limit)
    return this.keywordSearch(collection, query, limit)
  }

  async batchInsert(collection: string, objects: Array<{ id?: string; properties: Record<string, unknown>; vector?: number[] }>): Promise<BatchResult> {
    try {
      const colId = await this.getCollectionId(collection)
      const ids = objects.map((o) => o.id ?? crypto.randomUUID())
      const documents = objects.map((o) => String(o.properties.content ?? o.properties.text ?? ''))
      const metadatas = objects.map((o) => {
        const { content, text, ...rest } = o.properties
        return rest as Record<string, string | number | boolean>
      })
      const embeddings = objects.some((o) => o.vector) ? objects.map((o) => o.vector ?? []) : undefined
      await this.req(`/api/v1/collections/${colId}/add`, {
        method: 'POST',
        body: JSON.stringify({
          ids,
          documents,
          metadatas,
          ...(embeddings ? { embeddings } : {}),
        }),
      })
      return { success: objects.length, errors: [] }
    } catch (e) {
      return { success: 0, errors: [e instanceof Error ? e.message : 'Batch insert failed'] }
    }
  }
}
