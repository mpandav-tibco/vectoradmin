import type { SearchResult, EmbeddingConfig, LLMConfig, SearchType } from '@/types/domain'
import type { ConnectionConfig } from '@/types/domain'
import { embedSingle } from '@/lib/embedding/client'
import { getAdapter } from '@/lib/adapters'

export type RAGStep = 'embedding' | 'retrieving' | 'generating'

export async function runRAGQuery(opts: {
  query: string
  className: string
  topK: number
  searchType: SearchType
  alpha?: number
  embeddingConfig: EmbeddingConfig
  llmConfig: LLMConfig
  properties: string[]
  connectionConfig?: ConnectionConfig | null
  onChunk?: (chunk: string) => void
  onStep?: (step: RAGStep) => void
}): Promise<{ answer: string; sources: SearchResult[]; context: string }> {

  if (!opts.connectionConfig) throw new Error('Not connected to a database')
  const adapter = getAdapter(opts.connectionConfig)

  // Step 1: retrieve
  let sources: SearchResult[] = []

  if (opts.searchType === 'semantic') {
    opts.onStep?.('embedding')
    let vector: number[]
    try {
      vector = await embedSingle(opts.query, opts.embeddingConfig)
    } catch (err) {
      throw new Error(`Embedding failed — ${err instanceof Error ? err.message : String(err)}`)
    }
    opts.onStep?.('retrieving')
    sources = await adapter.vectorSearch(opts.className, vector, opts.topK, opts.properties)
  } else if (opts.searchType === 'bm25') {
    opts.onStep?.('retrieving')
    sources = await adapter.keywordSearch(opts.className, opts.query, opts.topK, opts.properties)
  } else {
    // hybrid — try to embed, fall back to keyword-only
    let vector: number[] | undefined
    try {
      opts.onStep?.('embedding')
      vector = await embedSingle(opts.query, opts.embeddingConfig)
    } catch {
      // embedding unavailable — hybrid will degrade to keyword (alpha ignored)
    }
    opts.onStep?.('retrieving')
    sources = await adapter.hybridSearch(opts.className, opts.query, vector, opts.alpha ?? 0.5, opts.topK, opts.properties)
  }

  // Step 2: format context
  const context = sources
    .map((s, i) => {
      const content = String(s.properties.content ?? JSON.stringify(s.properties))
      return `[Source ${i + 1}] (score: ${s.score.toFixed(4)})\n${content}`
    })
    .join('\n\n---\n\n')

  // Step 3: call LLM
  opts.onStep?.('generating')
  let answer: string
  try {
    answer = await callLLM(opts.query, context, opts.llmConfig, opts.onChunk)
  } catch (err) {
    throw new Error(`LLM generation failed — ${err instanceof Error ? err.message : String(err)}`)
  }

  return { answer, sources, context }
}

async function callLLM(
  query: string,
  context: string,
  config: LLMConfig,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const systemPrompt =
    config.systemPrompt ||
    `You are a helpful assistant. Answer the user's question based on the provided context.
If the answer is not in the context, say so clearly.

Context:
${context}`

  if (config.provider === 'ollama') {
    return callOllama(query, systemPrompt, config, onChunk)
  }
  return callOpenAICompatible(query, systemPrompt, config, onChunk)
}

async function callOpenAICompatible(
  query: string,
  systemPrompt: string,
  config: LLMConfig,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const baseURL = config.baseURL || 'https://api.openai.com'
  let resp: Response
  try {
    resp = await fetch(`${baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        max_tokens: config.maxTokens ?? 1024,
        temperature: config.temperature ?? 0.7,
        stream: !!onChunk,
      }),
    })
  } catch {
    throw new Error(`Cannot reach ${config.provider === 'custom' ? 'custom LLM' : 'OpenAI'} at ${baseURL} — check Base URL and API key`)
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    let body: { error?: { message?: string } } = {}
    try { if (text) body = JSON.parse(text) } catch {}
    throw new Error(body?.error?.message ?? `LLM API error: HTTP ${resp.status}`)
  }
  if (onChunk && resp.body) return streamSSE(resp.body, onChunk)
  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content ?? ''
}

async function callOllama(
  query: string,
  systemPrompt: string,
  config: LLMConfig,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const baseURL = config.baseURL || '/api/ollama'
  let resp: Response
  try {
    resp = await fetch(`${baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        stream: !!onChunk,
      }),
    })
  } catch {
    throw new Error(`Cannot reach Ollama at ${baseURL} — is it running? Start with: docker compose up -d ollama`)
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Ollama error: HTTP ${resp.status}${text ? ' — ' + text.slice(0, 120) : ''}`)
  }
  if (onChunk && resp.body) {
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let full = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value).split('\n').filter(Boolean)) {
        try {
          const obj = JSON.parse(line)
          const chunk = obj.message?.content ?? ''
          if (chunk) { onChunk(chunk); full += chunk }
        } catch {}
      }
    }
    return full
  }
  const data = await resp.json()
  return data.message?.content ?? ''
}

async function streamSSE(body: ReadableStream, onChunk: (chunk: string) => void): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    for (const line of decoder.decode(value).split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
      try {
        const obj = JSON.parse(line.slice(6))
        const chunk = obj.choices?.[0]?.delta?.content ?? ''
        if (chunk) { onChunk(chunk); full += chunk }
      } catch {}
    }
  }
  return full
}
