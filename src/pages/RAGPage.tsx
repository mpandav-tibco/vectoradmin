import { useState } from 'react'
import { Play, Loader2, AlertCircle, ChevronDown, ChevronUp, Clock, Trash2, CheckCircle2, Download } from 'lucide-react'
import type { RAGStep } from '@/lib/rag/pipeline'
import { useCollections } from '@/hooks/useCollections'
import { useAppStore } from '@/store/appStore'
import { useConnectionStore } from '@/store/connectionStore'
import { runRAGQuery } from '@/lib/rag/pipeline'
import { generateId, truncate, formatDate } from '@/lib/utils/format'
import type { SearchResult, SearchType, EmbeddingConfig, LLMConfig } from '@/types/domain'
import { cn } from '@/lib/utils/cn'

function EmbedPanel({ value, onChange }: { value: EmbeddingConfig; onChange: (v: EmbeddingConfig) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <select className="input text-xs" value={value.provider}
        onChange={(e) => onChange({ ...value, provider: e.target.value as EmbeddingConfig['provider'] })}>
        <option value="ollama">Ollama</option><option value="openai">OpenAI</option>
        <option value="cohere">Cohere</option><option value="custom">Custom</option>
      </select>
      <input className="input text-xs" placeholder="model" value={value.model}
        onChange={(e) => onChange({ ...value, model: e.target.value })} />
      {value.provider !== 'ollama' && (
        <input className="input text-xs font-mono col-span-2" type="password" placeholder="API key"
          value={value.apiKey ?? ''} onChange={(e) => onChange({ ...value, apiKey: e.target.value })} />
      )}
      <input className="input text-xs font-mono col-span-2" placeholder="Base URL"
        value={value.baseURL ?? ''} onChange={(e) => onChange({ ...value, baseURL: e.target.value })} />
    </div>
  )
}

function LLMPanel({ value, onChange }: { value: LLMConfig; onChange: (v: LLMConfig) => void }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select className="input text-xs" value={value.provider}
          onChange={(e) => onChange({ ...value, provider: e.target.value as LLMConfig['provider'] })}>
          <option value="ollama">Ollama</option><option value="openai">OpenAI</option><option value="custom">Custom</option>
        </select>
        <input className="input text-xs" placeholder="model" value={value.model}
          onChange={(e) => onChange({ ...value, model: e.target.value })} />
        {value.provider !== 'ollama' && (
          <input className="input text-xs font-mono col-span-2" type="password" placeholder="API key"
            value={value.apiKey ?? ''} onChange={(e) => onChange({ ...value, apiKey: e.target.value })} />
        )}
        <input className="input text-xs font-mono col-span-2" placeholder="Base URL"
          value={value.baseURL ?? ''} onChange={(e) => onChange({ ...value, baseURL: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Temperature</label>
          <input type="number" className="input text-xs text-center" min={0} max={2} step={0.1}
            value={value.temperature ?? 0.7} onChange={(e) => onChange({ ...value, temperature: Number(e.target.value) })} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Max tokens</label>
          <input type="number" className="input text-xs text-center"
            value={value.maxTokens ?? 1024} onChange={(e) => onChange({ ...value, maxTokens: Number(e.target.value) })} />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">System prompt</label>
        <textarea className="input text-xs h-20 resize-none" placeholder="You are a helpful assistant…"
          value={value.systemPrompt ?? ''} onChange={(e) => onChange({ ...value, systemPrompt: e.target.value })} />
      </div>
    </div>
  )
}

export function RAGPage() {
  const { data: collections } = useCollections()
  const config = useConnectionStore((s) => s.config)
  const { searchType, setSearchType, alpha, topK, setTopK, embeddingConfig, setEmbeddingConfig, llmConfig, setLLMConfig, ragHistory, addRAGHistory, clearRAGHistory } = useAppStore()

  const [query, setQuery] = useState('')
  const [className, setClassName] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState<RAGStep | null>(null)
  const [completedSteps, setCompletedSteps] = useState<RAGStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<SearchResult[]>([])
  const [context, setContext] = useState('')
  const [showConfig, setShowConfig] = useState(true)
  const [activeTab, setActiveTab] = useState<'answer' | 'context' | 'sources' | 'history'>('answer')

  const selectedCollection = collections?.find((c) => c.name === className)
  const properties = selectedCollection?.properties?.map((p) => p.name) ?? ['content']

  const PIPELINE_STEPS: { key: RAGStep; label: string }[] = [
    { key: 'embedding', label: 'Embedding query' },
    { key: 'retrieving', label: 'Retrieving context' },
    { key: 'generating', label: 'Generating answer' },
  ]

  const exportRAG = (format: 'json' | 'csv') => {
    const dl = (content: string, mime: string, ext: string) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([content], { type: mime }))
      a.download = `rag-${className}-${Date.now()}.${ext}`
      a.click()
      URL.revokeObjectURL(a.href)
    }
    if (format === 'json') {
      dl(JSON.stringify({ query, answer, context, sources, collectionName: className, searchType, topK, timestamp: Date.now() }, null, 2), 'application/json', 'json')
    } else {
      const propKeys = [...new Set(sources.flatMap((r) => Object.keys(r.properties)))]
      const esc = (v: unknown) => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s }
      const rows = sources.map((r, i) => [i + 1, r.id, r.score.toFixed(4), ...propKeys.map((k) => r.properties[k])].map(esc).join(','))
      dl(['rank,id,score,' + propKeys.join(','), ...rows].join('\n'), 'text/csv', 'csv')
    }
  }

  const handleRun = async () => {
    if (!query.trim() || !className) return
    setLoading(true)
    setError(null)
    setAnswer('')
    setSources([])
    setContext('')
    setCurrentStep(null)
    setCompletedSteps([])
    setActiveTab('answer')
    try {
      const result = await runRAGQuery({
        query,
        className,
        topK,
        searchType,
        alpha,
        embeddingConfig,
        llmConfig,
        properties,
        connectionConfig: config,
        onChunk: (chunk) => setAnswer((a) => a + chunk),
        onStep: (step) => {
          setCurrentStep((prev) => {
            if (prev) setCompletedSteps((c) => [...c, prev])
            return step
          })
        },
      })
      setCurrentStep(null)
      setCompletedSteps(['embedding', 'retrieving', 'generating'])
      setAnswer(result.answer)
      setSources(result.sources)
      setContext(result.context)
      addRAGHistory({
        id: generateId(),
        timestamp: Date.now(),
        query,
        answer: result.answer,
        sources: result.sources,
        collectionName: className,
        searchType,
        topK,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'RAG query failed')
    } finally {
      setLoading(false)
    }
  }

  const SEARCH_TYPES: { type: SearchType; label: string }[] = [
    { type: 'semantic', label: 'Semantic' },
    { type: 'bm25', label: 'BM25' },
    { type: 'hybrid', label: 'Hybrid' },
  ]

  return (
    <div className="flex gap-5 h-full max-h-[calc(100vh-8rem)]">
      {/* Left config panel */}
      <div className="w-72 flex-shrink-0 space-y-3 overflow-y-auto">
        <h2 className="text-sm font-semibold text-gray-100">RAG Playground</h2>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Collection</label>
          <select className="input text-sm" value={className} onChange={(e) => setClassName(e.target.value)}>
            <option value="">Select…</option>
            {collections?.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Search type</label>
          <div className="flex rounded overflow-hidden border border-border">
            {SEARCH_TYPES.map(({ type, label }) => (
              <button key={type} onClick={() => setSearchType(type)}
                className={cn('flex-1 py-1.5 text-xs transition-colors', searchType === type
                  ? 'bg-accent text-white' : 'bg-surface-200 text-gray-400 hover:text-gray-100')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Top-K</label>
          <input type="number" className="input text-sm text-center" min={1} max={50}
            value={topK} onChange={(e) => setTopK(Number(e.target.value))} />
        </div>

        {/* Embedding */}
        <div className="card p-3 space-y-2">
          <button onClick={() => setShowConfig((v) => !v)} className="flex items-center justify-between w-full">
            <p className="text-xs font-medium text-gray-400">Embedding</p>
            {showConfig ? <ChevronUp className="w-3 h-3 text-gray-600" /> : <ChevronDown className="w-3 h-3 text-gray-600" />}
          </button>
          {showConfig && <EmbedPanel value={embeddingConfig} onChange={setEmbeddingConfig} />}
        </div>

        {/* LLM */}
        <div className="card p-3 space-y-2">
          <p className="text-xs font-medium text-gray-400">LLM</p>
          <LLMPanel value={llmConfig} onChange={setLLMConfig} />
        </div>
      </div>

      {/* Right output panel */}
      <div className="flex-1 min-w-0 flex flex-col space-y-3">
        {/* Query input */}
        <div className="flex gap-2">
          <textarea
            className="input flex-1 resize-none text-sm"
            rows={2}
            placeholder="Ask a question about your documents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleRun() }}
          />
          <button onClick={handleRun} disabled={loading || !className || !query.trim()} className="btn-primary px-5 self-stretch">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-gray-600 -mt-1">Ctrl+Enter to run</p>

        {/* Pipeline step tracker */}
        {(loading || completedSteps.length > 0) && !error && (
          <div className="flex items-center gap-3">
            {PIPELINE_STEPS.map(({ key, label }) => {
              const done = completedSteps.includes(key)
              const active = currentStep === key
              return (
                <div key={key} className="flex items-center gap-1.5">
                  {done ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  ) : active ? (
                    <Loader2 className="w-3.5 h-3.5 text-accent animate-spin flex-shrink-0" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-gray-700 flex-shrink-0" />
                  )}
                  <span className={cn('text-xs', done ? 'text-green-400' : active ? 'text-accent' : 'text-gray-600')}>
                    {label}
                  </span>
                  {key !== 'generating' && <span className="text-gray-700 text-xs mx-1">→</span>}
                </div>
              )
            })}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-sm text-red-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {/* Output tabs */}
        <div className="flex items-center gap-1 border-b border-border">
          {[
            { key: 'answer', label: 'Answer' },
            { key: 'sources', label: `Sources (${sources.length})` },
            { key: 'context', label: 'Context' },
            { key: 'history', label: `History (${ragHistory.length})` },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setActiveTab(key as typeof activeTab)}
              className={cn('px-3 py-2 text-xs transition-colors border-b-2 -mb-px', activeTab === key
                ? 'border-accent text-accent font-medium' : 'border-transparent text-gray-400 hover:text-gray-100')}>
              {label}
            </button>
          ))}
          {answer && !loading && (
            <div className="flex items-center gap-1 ml-auto pb-1">
              <button onClick={() => exportRAG('json')} className="btn-ghost text-xs gap-1" title="Export full session as JSON">
                <Download className="w-3 h-3" /> JSON
              </button>
              <button onClick={() => exportRAG('csv')} className="btn-ghost text-xs gap-1" title="Export sources as CSV">
                <Download className="w-3 h-3" /> CSV
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Answer */}
          {activeTab === 'answer' && (
            <div className="prose prose-invert prose-sm max-w-none">
              {!answer && !loading && <p className="text-gray-600 text-sm">Run a query to see the answer…</p>}
              {loading && !answer && <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Thinking…</div>}
              {answer && <p className="text-gray-200 leading-relaxed whitespace-pre-wrap">{answer}</p>}
            </div>
          )}

          {/* Sources */}
          {activeTab === 'sources' && (
            <div className="space-y-2">
              {sources.length === 0 && <p className="text-gray-600 text-sm">No sources yet</p>}
              {sources.map((s, i) => (
                <div key={s.id} className="card p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-gray-500">{i + 1}. {s.id.slice(0, 16)}…</span>
                    <span className="badge bg-accent-muted text-accent">{s.score.toFixed(4)}</span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {truncate(String(s.properties.content ?? JSON.stringify(s.properties)), 300)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Context */}
          {activeTab === 'context' && (
            <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap leading-relaxed">
              {context || 'No context yet'}
            </pre>
          )}

          {/* History */}
          {activeTab === 'history' && (
            <div className="space-y-2">
              <div className="flex justify-end">
                <button onClick={clearRAGHistory} className="btn-ghost text-xs gap-1 text-red-500">
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              </div>
              {ragHistory.length === 0 && <p className="text-gray-600 text-sm">No history yet</p>}
              {ragHistory.map((entry) => (
                <button key={entry.id} onClick={() => { setQuery(entry.query); setAnswer(entry.answer); setSources(entry.sources); setActiveTab('answer') }}
                  className="card p-3 w-full text-left hover:bg-surface-200 transition-colors space-y-1">
                  <div className="flex items-center gap-2 text-gray-500 text-xs">
                    <Clock className="w-3 h-3" />
                    {formatDate(entry.timestamp)} · {entry.collectionName}
                  </div>
                  <p className="text-sm text-gray-200 font-medium">{truncate(entry.query, 80)}</p>
                  <p className="text-xs text-gray-500">{truncate(entry.answer, 100)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
