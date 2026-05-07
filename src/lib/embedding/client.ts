import type { EmbeddingConfig } from '@/types/domain'

export async function embed(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  switch (config.provider) {
    case 'openai':
      return embedOpenAI(texts, config)
    case 'ollama':
      return embedOllama(texts, config)
    case 'cohere':
      return embedCohere(texts, config)
    case 'custom':
      return embedOpenAI(texts, config) // OpenAI-compatible
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`)
  }
}

export async function embedSingle(text: string, config: EmbeddingConfig): Promise<number[]> {
  const results = await embed([text], config)
  return results[0]
}

async function embedOpenAI(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const baseURL = config.baseURL || 'https://api.openai.com'
  let resp: Response
  try {
    resp = await fetch(`${baseURL}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, input: texts }),
    })
  } catch {
    throw new Error(`Cannot reach ${config.provider === 'custom' ? 'custom endpoint' : 'OpenAI'} at ${baseURL} — check the Base URL in Embedding config`)
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `OpenAI embedding failed: ${resp.status}`)
  }
  const data = await resp.json()
  return (data.data as Array<{ embedding: number[]; index: number }>)
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding)
}

async function embedOllama(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const baseURL = config.baseURL || '/api/ollama'
  const results: number[][] = []
  for (const text of texts) {
    let resp: Response
    try {
      resp = await fetch(`${baseURL}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, input: text }),
      })
    } catch {
      throw new Error(`Cannot reach Ollama at ${baseURL} — is it running? Start with: docker compose up -d ollama`)
    }
    if (!resp.ok) throw new Error(`Ollama embedding failed: ${resp.status}`)
    const data = await resp.json()
    results.push(data.embeddings?.[0] ?? data.embedding)
  }
  return results
}

async function embedCohere(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const resp = await fetch('https://api.cohere.ai/v2/embed', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'embed-english-v3.0',
      texts,
      input_type: 'search_query',
      embedding_types: ['float'],
    }),
  })
  if (!resp.ok) throw new Error(`Cohere embedding failed: ${resp.status}`)
  const data = await resp.json()
  return data.embeddings.float as number[][]
}
