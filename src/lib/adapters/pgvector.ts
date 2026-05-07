import { buildBaseURL } from '@/lib/weaviate/client'
import type { ConnectionConfig, SearchResult } from '@/types/domain'
import type { DBAdapter, DBCollection, DBObject, DBHealthStatus, CreateCollectionInput, BatchResult } from './types'

// PostgREST adapter for PostgreSQL + pgvector.
// Requires PostgREST (https://postgrest.org) running in front of your Postgres instance.
// Default PostgREST port: 3000.

const VECTOR_COLS = ['embedding', 'vector', 'vectors', 'embeddings']

function parseVectorStr(s: unknown): number[] | undefined {
  if (Array.isArray(s)) return s as number[]
  if (typeof s !== 'string') return undefined
  try {
    const normalized = s.startsWith('[') ? s : `[${s.slice(1, -1)}]`
    const arr = JSON.parse(normalized)
    return Array.isArray(arr) ? (arr as number[]) : undefined
  } catch {
    return undefined
  }
}

function mapRow(row: Record<string, unknown>): DBObject {
  const vecKey = VECTOR_COLS.find((k) => k in row)
  const vec = vecKey ? parseVectorStr(row[vecKey]) : undefined
  const id = String(row.id ?? '')
  const properties: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k !== 'id' && k !== vecKey) properties[k] = v
  }
  return { id, properties, vector: vec }
}

export class PgvectorAdapter implements DBAdapter {
  private baseURL: string
  private headers: Record<string, string>

  constructor(private config: ConnectionConfig) {
    this.baseURL = buildBaseURL(config)
    this.headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    }
  }

  private url(path: string) { return `${this.baseURL}${path}` }

  private async req(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(this.url(path), {
      ...init,
      headers: { ...this.headers, ...((init?.headers as Record<string, string>) ?? {}) },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let msg = `HTTP ${res.status}`
      try {
        const j = JSON.parse(text) as Record<string, string>
        msg = j.message ?? j.hint ?? j.details ?? msg
      } catch { /* noop */ }
      throw new Error(msg)
    }
    return res
  }

  async checkHealth(): Promise<DBHealthStatus> {
    try {
      const res = await fetch(this.url('/'), {
        headers: { ...this.headers, Accept: 'application/openapi+json' },
      })
      if (!res.ok) return { ready: false, error: `HTTP ${res.status}` }
      const data = await res.json() as { info?: { version?: string } }
      return { ready: true, version: data?.info?.version ?? 'PostgREST' }
    } catch (e) {
      return { ready: false, error: e instanceof Error ? e.message : 'Connection failed' }
    }
  }

  async listCollections(): Promise<DBCollection[]> {
    const res = await fetch(this.url('/'), {
      headers: { ...this.headers, Accept: 'application/openapi+json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const spec = await res.json() as { paths?: Record<string, unknown> }
    return Object.keys(spec?.paths ?? {})
      .filter((p) => p.startsWith('/') && !p.includes('{') && !p.startsWith('/rpc'))
      .map((p) => ({ name: p.slice(1) }))
  }

  async getCollection(name: string): Promise<DBCollection> {
    const res = await fetch(this.url(`/${name}?limit=0`), {
      headers: { ...this.headers, Prefer: 'count=exact' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const cr = res.headers.get('Content-Range')
    const total = parseInt(cr?.split('/')[1] ?? '', 10)
    return { name, objectCount: isNaN(total) ? undefined : total }
  }

  async createCollection(_input: CreateCollectionInput): Promise<void> {
    throw new Error('PostgREST exposes existing tables only — create the table via SQL first, then restart PostgREST.')
  }

  async deleteCollection(_name: string): Promise<void> {
    throw new Error('Drop tables via SQL directly — PostgREST does not expose DDL.')
  }

  async getObjectCount(name: string): Promise<number> {
    const res = await fetch(this.url(`/${name}?limit=0`), {
      headers: { ...this.headers, Prefer: 'count=exact' },
    })
    const cr = res.headers.get('Content-Range')
    const n = parseInt(cr?.split('/')[1] ?? '', 10)
    return isNaN(n) ? 0 : n
  }

  async listObjects(collection: string, limit: number, offset: number): Promise<{ objects: DBObject[]; total: number }> {
    const res = await this.req(
      `/${collection}?limit=${limit}&offset=${offset}&select=*`,
      { headers: { Prefer: 'count=exact' } }
    )
    const cr = res.headers.get('Content-Range')
    const total = parseInt(cr?.split('/')[1] ?? '0', 10) || 0
    const rows = await res.json() as Record<string, unknown>[]
    return { total, objects: rows.map(mapRow) }
  }

  async createObject(collection: string, properties: Record<string, unknown>, vector?: number[]): Promise<string> {
    const body = { ...properties, ...(vector ? { embedding: vector } : {}) }
    const res = await this.req(`/${collection}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    })
    const [row] = await res.json() as Record<string, unknown>[]
    return String(row?.id ?? '')
  }

  async deleteObject(collection: string, id: string): Promise<void> {
    await this.req(`/${collection}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async vectorSearch(collection: string, vector: number[], limit: number): Promise<SearchResult[]> {
    const rpcName = `match_${collection}`
    let res: Response
    try {
      res = await this.req(`/rpc/${rpcName}`, {
        method: 'POST',
        body: JSON.stringify({ query_embedding: vector, match_count: limit }),
      })
    } catch (e) {
      const base = e instanceof Error ? e.message : `HTTP error`
      throw new Error(
        `${base}. Add a vector search function:\n` +
        `CREATE OR REPLACE FUNCTION ${rpcName}(query_embedding vector, match_count int)\n` +
        `RETURNS TABLE(id text, similarity float) LANGUAGE plpgsql AS $$…$$`
      )
    }
    const rows = await res.json() as Record<string, unknown>[]
    return rows.map((r) => ({
      id: String(r.id ?? ''),
      score: Number(r.similarity ?? r.score ?? 0),
      distance: Number(r.distance ?? 0),
      class: collection,
      properties: Object.fromEntries(
        Object.entries(r).filter(([k]) => k !== 'id' && !VECTOR_COLS.includes(k))
      ),
    }))
  }

  async keywordSearch(collection: string, query: string, limit: number, properties?: string[]): Promise<SearchResult[]> {
    const col = properties?.[0] ?? 'content'
    const q = encodeURIComponent(query)
    const res = await this.req(`/${collection}?${col}=ilike.*${q}*&limit=${limit}&select=*`)
    const rows = await res.json() as Record<string, unknown>[]
    return rows.map((r) => {
      const obj = mapRow(r)
      return { id: obj.id, score: 1, class: collection, properties: obj.properties }
    })
  }

  async hybridSearch(
    collection: string, query: string, vector: number[] | undefined,
    _alpha: number, limit: number, properties?: string[]
  ): Promise<SearchResult[]> {
    if (vector) return this.vectorSearch(collection, vector, limit)
    return this.keywordSearch(collection, query, limit, properties)
  }

  async batchInsert(
    collection: string,
    objects: Array<{ id?: string; properties: Record<string, unknown>; vector?: number[] }>
  ): Promise<BatchResult> {
    const body = objects.map(({ id, properties, vector }) => ({
      ...(id ? { id } : {}),
      ...properties,
      ...(vector ? { embedding: vector } : {}),
    }))
    try {
      const res = await fetch(this.url(`/${collection}`), {
        method: 'POST',
        headers: { ...this.headers, Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.text().catch(() => `HTTP ${res.status}`)
        return { success: 0, errors: [err] }
      }
      return { success: objects.length, errors: [] }
    } catch (e) {
      return { success: 0, errors: [e instanceof Error ? e.message : 'Batch failed'] }
    }
  }
}
