import type { SearchResult } from '@/types/domain'
import { checkHealth } from '@/lib/weaviate/health'
import { listCollections, getCollection, createCollection, deleteCollection, getObjectCount } from '@/lib/weaviate/schema'
import { listObjects, createObject, deleteObject, batchUpsert } from '@/lib/weaviate/objects'
import { nearVectorSearch, bm25Search, hybridSearch as weaviateHybrid } from '@/lib/weaviate/graphql'
import type { ConnectionConfig, FilterCondition } from '@/types/domain'
import type { DBAdapter, DBCollection, DBObject, DBHealthStatus, CreateCollectionInput, BatchResult } from './types'

const FALLBACK_PROPS = ['content', 'text', 'title']

export class WeaviateAdapter implements DBAdapter {
  constructor(private config: ConnectionConfig) {}

  async checkHealth(): Promise<DBHealthStatus> {
    return checkHealth(this.config)
  }

  async listCollections(): Promise<DBCollection[]> {
    const cols = await listCollections(this.config)
    return cols.map((c) => ({
      name: c.class,
      description: c.description,
      distance: c.vectorIndexConfig?.distance,
      vectorizer: c.vectorizer,
      properties: c.properties?.map((p) => ({
        name: p.name,
        dataType: p.dataType[0] ?? 'text',
        searchable: p.indexSearchable,
        filterable: p.indexFilterable,
      })),
    }))
  }

  async getCollection(name: string): Promise<DBCollection> {
    const c = await getCollection(name, this.config)
    return {
      name: c.class,
      description: c.description,
      distance: c.vectorIndexConfig?.distance,
      vectorizer: c.vectorizer,
      properties: c.properties?.map((p) => ({
        name: p.name,
        dataType: p.dataType[0] ?? 'text',
        searchable: p.indexSearchable,
        filterable: p.indexFilterable,
      })),
    }
  }

  async createCollection(input: CreateCollectionInput): Promise<void> {
    // Weaviate class names must start with an uppercase letter
    const className = input.name.charAt(0).toUpperCase() + input.name.slice(1)
    // Primitive Weaviate types start with lowercase; cross-reference types start with
    // uppercase (another class name) and must be excluded when recreating in a new target
    const primitiveProps = input.properties?.filter((p) => /^[a-z]/.test(p.dataType))
    await createCollection(
      {
        class: className,
        description: input.description,
        vectorIndexConfig: { distance: input.distance ?? 'cosine' },
        vectorizer: 'none',
        properties: primitiveProps?.map((p) => ({
          name: p.name,
          dataType: [p.dataType],
          indexSearchable: true,
          indexFilterable: true,
        })),
      },
      this.config
    )
  }

  async deleteCollection(name: string): Promise<void> {
    await deleteCollection(name, this.config)
  }

  async getObjectCount(name: string): Promise<number> {
    return getObjectCount(name, this.config)
  }

  async listObjects(collection: string, limit: number, offset: number): Promise<{ objects: DBObject[]; total: number }> {
    const result = await listObjects(collection, { limit, offset, includeVector: true }, this.config)
    return {
      objects: result.objects.map((o) => ({
        id: o.id,
        properties: o.properties,
        vector: o.vector,
        class: o.class,
      })),
      total: result.total,
    }
  }

  async createObject(collection: string, properties: Record<string, unknown>, vector?: number[]): Promise<string> {
    const obj = await createObject({ class: collection, properties, vector }, this.config)
    return obj.id
  }

  async deleteObject(collection: string, id: string): Promise<void> {
    await deleteObject(collection, id, this.config)
  }

  async vectorSearch(collection: string, vector: number[], limit: number, properties?: string[], filters?: FilterCondition[]): Promise<SearchResult[]> {
    return nearVectorSearch({ className: collection, vector, limit, properties: properties ?? FALLBACK_PROPS, filters, config: this.config })
  }

  async keywordSearch(collection: string, query: string, limit: number, properties?: string[], filters?: FilterCondition[]): Promise<SearchResult[]> {
    return bm25Search({ className: collection, query, limit, properties: properties ?? FALLBACK_PROPS, filters, config: this.config })
  }

  async hybridSearch(collection: string, query: string, vector: number[] | undefined, alpha: number, limit: number, properties?: string[], filters?: FilterCondition[]): Promise<SearchResult[]> {
    return weaviateHybrid({ className: collection, query, vector, alpha, limit, properties: properties ?? FALLBACK_PROPS, filters, config: this.config })
  }

  async batchInsert(collection: string, objects: Array<{ id?: string; properties: Record<string, unknown>; vector?: number[] }>): Promise<BatchResult> {
    const mapped = objects.map((o) => ({ class: collection, ...o }))
    return batchUpsert(mapped, this.config)
  }
}

