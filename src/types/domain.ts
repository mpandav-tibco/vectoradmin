export type VectorDBType = 'weaviate' | 'qdrant' | 'pinecone' | 'chroma' | 'pgvector' | 'activespaces'

export interface ConnectionConfig {
  dbType: VectorDBType
  host: string
  port: number
  scheme: 'http' | 'https'
  apiKey?: string
  proxyURL?: string   // optional: route all requests through this URL instead of directly to host:port
}

export interface CollectionConfig {
  name: string
  dimensions?: number
  distanceMetric: 'cosine' | 'dot' | 'euclidean' | 'hamming'
  replicationFactor?: number
  description?: string
}

export interface WeaviateProperty {
  name: string
  dataType: string[]
  description?: string
  indexSearchable?: boolean
  indexFilterable?: boolean
  tokenization?: string
}

export interface WeaviateCollection {
  class: string
  description?: string
  vectorIndexType?: string
  vectorIndexConfig?: {
    distance?: string
    efConstruction?: number
    maxConnections?: number
  }
  vectorizer?: string
  moduleConfig?: Record<string, unknown>
  properties?: WeaviateProperty[]
  replicationConfig?: { factor: number }
}

export interface WeaviateObject {
  id: string
  class: string
  properties: Record<string, unknown>
  vector?: number[]
  creationTimeUnix?: number
  lastUpdateTimeUnix?: number
  additional?: {
    id?: string
    certainty?: number
    distance?: number
    score?: number
    explainScore?: string
  }
}

export interface SearchResult {
  id: string
  score: number
  certainty?: number
  distance?: number
  class: string
  properties: Record<string, unknown>
  vector?: number[]
  explainScore?: string
}

export type SearchType = 'semantic' | 'bm25' | 'hybrid'
export type ChunkStrategy = 'fixed' | 'sentence' | 'paragraph' | 'heading'
export type EmbeddingProvider = 'openai' | 'ollama' | 'cohere' | 'custom'
export type LLMProvider = 'openai' | 'ollama' | 'custom'

export interface EmbeddingConfig {
  provider: EmbeddingProvider
  apiKey?: string
  baseURL?: string
  model: string
  dimensions?: number
}

export interface LLMConfig {
  provider: LLMProvider
  apiKey?: string
  baseURL?: string
  model: string
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
}

export interface ChunkConfig {
  strategy: ChunkStrategy
  size: number
  overlap: number
}

export interface IngestResult {
  documentsIngested: number
  chunksCreated: number
  duration: number
  errors: string[]
}

export interface RAGHistoryEntry {
  id: string
  timestamp: number
  query: string
  answer: string
  sources: SearchResult[]
  collectionName: string
  searchType: SearchType
  topK: number
}

export interface FilterCondition {
  path: string
  operator: 'Equal' | 'NotEqual' | 'GreaterThan' | 'GreaterThanEqual' | 'LessThan' | 'LessThanEqual' | 'Like' | 'IsNull'
  valueType: 'valueText' | 'valueInt' | 'valueNumber' | 'valueBoolean' | 'valueDate'
  value: string | number | boolean
}
