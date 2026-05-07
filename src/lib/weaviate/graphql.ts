import { weaviateApi } from './client'
import type { SearchResult, FilterCondition } from '@/types/domain'
import type { ConnectionConfig } from '@/types/domain'

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

function escapeGql(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '')
}

function buildWhereClause(filter?: FilterCondition): string {
  if (!filter) return ''
  return `where: { path: ["${escapeGql(filter.path)}"], operator: ${filter.operator}, ${filter.valueType}: ${
    typeof filter.value === 'string' ? `"${escapeGql(String(filter.value))}"` : filter.value
  } }`
}

function extractResults(
  resp: GraphQLResponse<{ Get: Record<string, unknown[]> }>,
  className: string
): SearchResult[] {
  if (resp.errors?.length) throw new Error(resp.errors[0].message)
  const items = resp.data?.Get?.[className] ?? []
  return items.map((item) => {
    const obj = item as Record<string, unknown>
    const add = (obj._additional ?? {}) as Record<string, unknown>
    const { _additional, ...properties } = obj
    return {
      id: (add.id as string) ?? '',
      score: Number(add.score ?? add.certainty ?? 0),
      certainty: add.certainty != null ? Number(add.certainty) : undefined,
      distance: add.distance != null ? Number(add.distance) : undefined,
      class: className,
      properties,
      explainScore: add.explainScore as string | undefined,
    }
  })
}

function propertyList(props: string[]): string {
  return props.join('\n      ')
}

export async function semanticSearch(opts: {
  className: string
  concepts: string[]
  limit: number
  properties: string[]
  filter?: FilterCondition
  config?: ConnectionConfig | null
}): Promise<SearchResult[]> {
  const where = buildWhereClause(opts.filter)
  const query = `{
    Get {
      ${opts.className}(
        nearText: { concepts: ${JSON.stringify(opts.concepts)} }
        limit: ${opts.limit}
        ${where}
      ) {
        _additional { id certainty distance score }
        ${propertyList(opts.properties)}
      }
    }
  }`
  const resp = await weaviateApi.post<GraphQLResponse<{ Get: Record<string, unknown[]> }>>(
    '/v1/graphql',
    { query },
    opts.config
  )
  return extractResults(resp, opts.className)
}

export async function nearVectorSearch(opts: {
  className: string
  vector: number[]
  limit: number
  properties: string[]
  filter?: FilterCondition
  config?: ConnectionConfig | null
}): Promise<SearchResult[]> {
  const where = buildWhereClause(opts.filter)
  const query = `{
    Get {
      ${opts.className}(
        nearVector: { vector: [${opts.vector.join(',')}] }
        limit: ${opts.limit}
        ${where}
      ) {
        _additional { id certainty distance }
        ${propertyList(opts.properties)}
      }
    }
  }`
  const resp = await weaviateApi.post<GraphQLResponse<{ Get: Record<string, unknown[]> }>>(
    '/v1/graphql',
    { query },
    opts.config
  )
  return extractResults(resp, opts.className)
}

export async function bm25Search(opts: {
  className: string
  query: string
  limit: number
  properties: string[]
  searchProperties?: string[]
  filter?: FilterCondition
  config?: ConnectionConfig | null
}): Promise<SearchResult[]> {
  const where = buildWhereClause(opts.filter)
  const searchProps = opts.searchProperties?.length
    ? `, properties: ${JSON.stringify(opts.searchProperties)}`
    : ''
  const query = `{
    Get {
      ${opts.className}(
        bm25: { query: "${escapeGql(opts.query)}"${searchProps} }
        limit: ${opts.limit}
        ${where}
      ) {
        _additional { id score explainScore }
        ${propertyList(opts.properties)}
      }
    }
  }`
  const resp = await weaviateApi.post<GraphQLResponse<{ Get: Record<string, unknown[]> }>>(
    '/v1/graphql',
    { query },
    opts.config
  )
  return extractResults(resp, opts.className)
}

export async function hybridSearch(opts: {
  className: string
  query: string
  vector?: number[]
  alpha: number
  limit: number
  properties: string[]
  filter?: FilterCondition
  config?: ConnectionConfig | null
}): Promise<SearchResult[]> {
  const where = buildWhereClause(opts.filter)
  const vectorPart = opts.vector?.length ? `, vector: [${opts.vector.join(',')}]` : ''
  const query = `{
    Get {
      ${opts.className}(
        hybrid: { query: "${escapeGql(opts.query)}", alpha: ${opts.alpha}${vectorPart} }
        limit: ${opts.limit}
        ${where}
      ) {
        _additional { id score explainScore }
        ${propertyList(opts.properties)}
      }
    }
  }`
  const resp = await weaviateApi.post<GraphQLResponse<{ Get: Record<string, unknown[]> }>>(
    '/v1/graphql',
    { query },
    opts.config
  )
  return extractResults(resp, opts.className)
}

export async function getObjectsGraphQL(opts: {
  className: string
  limit: number
  offset: number
  properties: string[]
  config?: ConnectionConfig | null
}): Promise<SearchResult[]> {
  const query = `{
    Get {
      ${opts.className}(
        limit: ${opts.limit}
        offset: ${opts.offset}
      ) {
        _additional { id }
        ${propertyList(opts.properties)}
      }
    }
  }`
  const resp = await weaviateApi.post<GraphQLResponse<{ Get: Record<string, unknown[]> }>>(
    '/v1/graphql',
    { query },
    opts.config
  )
  return extractResults(resp, opts.className)
}
