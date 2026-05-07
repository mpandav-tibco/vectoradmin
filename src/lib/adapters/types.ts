import type { SearchResult } from '@/types/domain'

export interface DBCollection {
  name: string
  description?: string
  vectorDimensions?: number
  distance?: string
  objectCount?: number
  properties?: DBProperty[]
  vectorizer?: string
}

export interface DBProperty {
  name: string
  dataType: string
  searchable?: boolean
  filterable?: boolean
}

export interface DBObject {
  id: string
  properties: Record<string, unknown>
  vector?: number[]
  class?: string
}

export interface DBHealthStatus {
  ready: boolean
  version?: string
  error?: string
}

export interface CreateCollectionInput {
  name: string
  description?: string
  vectorDimensions?: number
  distance?: 'cosine' | 'dot' | 'euclidean' | 'hamming'
  properties?: Array<{ name: string; dataType: string }>
}

export interface BatchResult {
  success: number
  errors: string[]
}

export interface DBAdapter {
  checkHealth(): Promise<DBHealthStatus>
  listCollections(): Promise<DBCollection[]>
  getCollection(name: string): Promise<DBCollection>
  createCollection(input: CreateCollectionInput): Promise<void>
  deleteCollection(name: string): Promise<void>
  getObjectCount(name: string): Promise<number>
  listObjects(collection: string, limit: number, offset: number): Promise<{ objects: DBObject[]; total: number }>
  createObject(collection: string, properties: Record<string, unknown>, vector?: number[]): Promise<string>
  deleteObject(collection: string, id: string): Promise<void>
  vectorSearch(collection: string, vector: number[], limit: number, properties?: string[]): Promise<SearchResult[]>
  keywordSearch(collection: string, query: string, limit: number, properties?: string[]): Promise<SearchResult[]>
  hybridSearch(collection: string, query: string, vector: number[] | undefined, alpha: number, limit: number, properties?: string[]): Promise<SearchResult[]>
  batchInsert(collection: string, objects: Array<{ id?: string; properties: Record<string, unknown>; vector?: number[] }>): Promise<BatchResult>
}
