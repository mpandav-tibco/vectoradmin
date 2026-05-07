/**
 * Unit tests for src/lib/adapters/index.ts — getAdapter factory.
 */
import { describe, it, expect } from 'vitest'
import { getAdapter } from '@/lib/adapters'
import { WeaviateAdapter } from '@/lib/adapters/weaviate'
import { QdrantAdapter } from '@/lib/adapters/qdrant'
import { ChromaAdapter } from '@/lib/adapters/chroma'
import type { ConnectionConfig } from '@/types/domain'

function cfg(dbType: ConnectionConfig['dbType']): ConnectionConfig {
  return { dbType, host: 'localhost', port: 1234, scheme: 'http' }
}

describe('getAdapter', () => {
  it('returns WeaviateAdapter for dbType "weaviate"', () => {
    expect(getAdapter(cfg('weaviate'))).toBeInstanceOf(WeaviateAdapter)
  })

  it('returns QdrantAdapter for dbType "qdrant"', () => {
    expect(getAdapter(cfg('qdrant'))).toBeInstanceOf(QdrantAdapter)
  })

  it('returns ChromaAdapter for dbType "chroma"', () => {
    expect(getAdapter(cfg('chroma'))).toBeInstanceOf(ChromaAdapter)
  })

  it('throws for unsupported dbType "pinecone"', () => {
    expect(() => getAdapter(cfg('pinecone'))).toThrow(/pinecone.*not yet supported/i)
  })

  it('throws for unsupported dbType "pgvector"', () => {
    expect(() => getAdapter(cfg('pgvector'))).toThrow(/pgvector.*not yet supported/i)
  })

  it('throws for unsupported dbType "activespaces"', () => {
    expect(() => getAdapter(cfg('activespaces'))).toThrow(/activespaces.*not yet supported/i)
  })

  it('each call returns a fresh adapter instance', () => {
    const a = getAdapter(cfg('qdrant'))
    const b = getAdapter(cfg('qdrant'))
    expect(a).not.toBe(b)
  })
})
