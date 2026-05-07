import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Loader2, AlertCircle, Sliders, ChevronDown, ChevronUp, Download, Boxes, Filter, Plus, X } from 'lucide-react'
import { useCollections } from '@/hooks/useCollections'
import { useAppStore } from '@/store/appStore'
import { useConnectionStore } from '@/store/connectionStore'
import { getAdapter } from '@/lib/adapters'
import { embedSingle } from '@/lib/embedding/client'
import type { SearchResult, SearchType, EmbeddingConfig, FilterCondition } from '@/types/domain'
import { cn } from '@/lib/utils/cn'
import { truncate } from '@/lib/utils/format'

const OPERATORS: FilterCondition['operator'][] = [
  'Equal', 'NotEqual', 'Like', 'GreaterThan', 'GreaterThanEqual', 'LessThan', 'LessThanEqual', 'IsNull',
]

function applyFilters(results: SearchResult[], filters: FilterCondition[]): SearchResult[] {
  if (filters.length === 0) return results
  return results.filter((r) =>
    filters.every((f) => {
      if (!f.path) return true
      const val = r.properties[f.path]
      switch (f.operator) {
        case 'Equal': return String(val ?? '') === String(f.value)
        case 'NotEqual': return String(val ?? '') !== String(f.value)
        case 'Like': return String(val ?? '').toLowerCase().includes(String(f.value).toLowerCase())
        case 'GreaterThan': return Number(val) > Number(f.value)
        case 'GreaterThanEqual': return Number(val) >= Number(f.value)
        case 'LessThan': return Number(val) < Number(f.value)
        case 'LessThanEqual': return Number(val) <= Number(f.value)
        case 'IsNull': return val == null
      }
    })
  )
}

function newFilter(): FilterCondition {
  return { path: '', operator: 'Equal', valueType: 'valueText', value: '' }
}

function EmbeddingConfigPanel({ value, onChange }: { value: EmbeddingConfig; onChange: (v: EmbeddingConfig) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 p-3 bg-surface-200 rounded-lg border border-border">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Provider</label>
        <select className="input text-xs" value={value.provider}
          onChange={(e) => onChange({ ...value, provider: e.target.value as EmbeddingConfig['provider'] })}>
          <option value="ollama">Ollama (local)</option>
          <option value="openai">OpenAI</option>
          <option value="cohere">Cohere</option>
          <option value="custom">Custom (OpenAI-compat)</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Model</label>
        <input className="input text-xs" value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })}
          placeholder="nomic-embed-text" />
      </div>
      {value.provider !== 'ollama' && (
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">API Key</label>
          <input className="input text-xs font-mono" type="password" value={value.apiKey ?? ''}
            onChange={(e) => onChange({ ...value, apiKey: e.target.value })} placeholder="sk-…" />
        </div>
      )}
      {(value.provider === 'ollama' || value.provider === 'custom') && (
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Base URL</label>
          <input className="input text-xs font-mono" value={value.baseURL ?? ''}
            onChange={(e) => onChange({ ...value, baseURL: e.target.value })}
            placeholder="http://localhost:11434" />
        </div>
      )}
    </div>
  )
}

function ResultCard({ result, rank }: { result: SearchResult; rank: number }) {
  const [expanded, setExpanded] = useState(false)
  const content = String(result.properties.content ?? result.properties.text ?? JSON.stringify(result.properties))
  const score = result.score ?? result.certainty ?? 0

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-surface-300 text-xs text-gray-400 flex items-center justify-center flex-shrink-0">
            {rank}
          </span>
          <span className="text-xs font-mono text-gray-500">{result.id.slice(0, 16)}…</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {result.certainty !== undefined && (
            <span className="badge bg-green-900/40 text-green-400">{(result.certainty * 100).toFixed(1)}%</span>
          )}
          {result.distance !== undefined && (
            <span className="badge bg-blue-900/40 text-blue-400">d={result.distance.toFixed(4)}</span>
          )}
          {result.score !== undefined && result.certainty === undefined && (
            <span className="badge bg-accent-muted text-accent">{result.score.toFixed(4)}</span>
          )}
          <button onClick={() => setExpanded((v) => !v)} className="btn-ghost p-1">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-300 leading-relaxed">
        {expanded ? content : truncate(content, 200)}
      </p>
      {expanded && Object.keys(result.properties).filter((k) => k !== 'content' && k !== 'text').length > 0 && (
        <pre className="text-xs font-mono bg-surface-200 rounded p-2 text-gray-400 overflow-x-auto">
          {JSON.stringify(
            Object.fromEntries(Object.entries(result.properties).filter(([k]) => k !== 'content' && k !== 'text')),
            null, 2
          )}
        </pre>
      )}
      {expanded && result.explainScore && (
        <p className="text-xs text-gray-500 italic">{result.explainScore}</p>
      )}
    </div>
  )
}

export function SearchPage() {
  const navigate = useNavigate()
  const { data: collections } = useCollections()
  const config = useConnectionStore((s) => s.config)
  const { searchType, setSearchType, alpha, setAlpha, topK, setTopK, embeddingConfig, setEmbeddingConfig, setVizHighlight, addSearchLog } = useAppStore()

  const [query, setQuery] = useState('')
  const [className, setClassName] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showEmbedConfig, setShowEmbedConfig] = useState(searchType === 'semantic')
  const [duration, setDuration] = useState<number | null>(null)
  const [filters, setFilters] = useState<FilterCondition[]>([])
  const [showFilters, setShowFilters] = useState(false)

  const selectedCollection = collections?.find((c) => c.name === className)
  const properties = selectedCollection?.properties?.map((p) => p.name) ?? ['content', '_additional']

  const exportResults = (format: 'json' | 'csv') => {
    let content: string
    let mime: string
    let ext: string
    if (format === 'json') {
      content = JSON.stringify({ query, collection: className, searchType, results }, null, 2)
      mime = 'application/json'
      ext = 'json'
    } else {
      const propKeys = [...new Set(results.flatMap((r) => Object.keys(r.properties)))]
      const header = ['id', 'score', ...propKeys]
      const escape = (v: unknown) => {
        const s = String(v ?? '')
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
      }
      const rows = results.map((r) => [r.id, r.score, ...propKeys.map((k) => r.properties[k])].map(escape).join(','))
      content = [header.join(','), ...rows].join('\n')
      mime = 'text/csv'
      ext = 'csv'
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: mime }))
    a.download = `search-${className}-${Date.now()}.${ext}`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const translateError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : 'Search failed'
    if (msg.includes('nearText'))
      return 'This collection uses vectorizer: none — Semantic search requires a client-side embedding model. Open the Embedding panel, pick a provider (Ollama or OpenAI), and try again.'
    if (msg.includes('Cannot reach Ollama'))
      return `${msg}\n\nTip: start Ollama with: docker compose --profile ollama up -d`
    if (msg.includes('Embedding failed') || msg.includes('embed'))
      return `Embedding error: ${msg}\n\nOpen the Embedding panel and verify your provider settings.`
    return msg
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim() || !className) return
    setLoading(true)
    setError(null)
    const t0 = Date.now()
    try {
      let res: SearchResult[] = []
      const adapter = getAdapter(config!)
      if (searchType === 'semantic') {
        let vector: number[]
        try {
          vector = await embedSingle(query, embeddingConfig)
        } catch (embedErr) {
          throw new Error(`Embedding failed — ${embedErr instanceof Error ? embedErr.message : 'check your embedding provider settings'}`)
        }
        res = await adapter.vectorSearch(className, vector, topK, properties)
      } else if (searchType === 'bm25') {
        res = await adapter.keywordSearch(className, query, topK, properties)
      } else {
        let vector: number[] | undefined
        try { vector = await embedSingle(query, embeddingConfig) } catch {}
        res = await adapter.hybridSearch(className, query, vector, alpha, topK, properties)
      }
      const filtered = applyFilters(res, filters)
      setResults(filtered)
      const elapsed = Date.now() - t0
      setDuration(elapsed)
      addSearchLog({
        timestamp: Date.now(),
        collectionName: className,
        query: query.trim(),
        searchType,
        resultCount: filtered.length,
        topScore: res[0]?.score ?? res[0]?.certainty,
        durationMs: elapsed,
      })
    } catch (err) {
      setError(translateError(err))
    } finally {
      setLoading(false)
    }
  }

  const TYPES: { type: SearchType; label: string }[] = [
    { type: 'semantic', label: 'Semantic' },
    { type: 'bm25', label: 'BM25' },
    { type: 'hybrid', label: 'Hybrid' },
  ]

  return (
    <div className="space-y-4 max-w-3xl">
      <h2 className="text-lg font-semibold text-gray-100">Search</h2>

      <form onSubmit={handleSearch} className="space-y-3">
        {/* Collection + search type */}
        <div className="flex gap-3">
          <select className="input flex-1" value={className} onChange={(e) => setClassName(e.target.value)} required>
            <option value="">Select collection…</option>
            {collections?.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <div className="flex rounded-md overflow-hidden border border-border">
            {TYPES.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                title={
                  type === 'semantic' ? 'Pure vector similarity — requires an embedding model' :
                  type === 'bm25' ? 'Keyword search — no embedding needed' :
                  'Blend of keyword + vector — embedding optional'
                }
                onClick={() => {
                  setSearchType(type)
                  if (type === 'semantic') setShowEmbedConfig(true)
                }}
                className={cn('px-3 py-1.5 text-sm transition-colors', searchType === type
                  ? 'bg-accent text-white' : 'bg-surface-200 text-gray-400 hover:text-gray-100')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Semantic mode hint */}
        {searchType === 'semantic' && (
          <div className="flex items-start gap-2 px-3 py-2 bg-accent-muted/40 border border-accent/30 rounded text-xs text-gray-400">
            <span className="text-accent mt-0.5">ℹ</span>
            <span>
              Semantic search generates an embedding of your query then finds the closest vectors in the collection.
              Your collections use <code className="font-mono text-gray-300">vectorizer: none</code>, so you need a local or cloud embedding model —
              configure one in the <strong className="text-gray-300">Embedding</strong> panel below.
            </span>
          </div>
        )}

        {/* Query input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input className="input pl-9" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={searchType === 'bm25' ? 'Keyword search…' : 'Semantic query…'} />
          </div>
          <button type="submit" disabled={loading || !className} className="btn-primary px-5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
          </button>
        </div>

        {/* Advanced controls */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Top-K</label>
            <input type="number" className="input w-16 text-center text-xs" min={1} max={100}
              value={topK} onChange={(e) => setTopK(Number(e.target.value))} />
          </div>
          {searchType === 'hybrid' && (
            <div className="flex items-center gap-2 flex-1">
              <span className="text-xs text-gray-500">BM25</span>
              <input type="range" min={0} max={1} step={0.05} value={alpha}
                onChange={(e) => setAlpha(Number(e.target.value))} className="flex-1 accent-indigo-500" />
              <span className="text-xs text-gray-500">Vector</span>
              <span className="text-xs font-mono text-gray-400 w-8">α={alpha.toFixed(2)}</span>
            </div>
          )}
          {(searchType === 'semantic' || searchType === 'hybrid') && (
            <button type="button" onClick={() => setShowEmbedConfig((v) => !v)} className="btn-ghost text-xs gap-1 ml-auto">
              <Sliders className="w-3.5 h-3.5" /> Embedding
            </button>
          )}
        </div>

        {showEmbedConfig && (searchType === 'semantic' || searchType === 'hybrid') && (
          <EmbeddingConfigPanel value={embeddingConfig} onChange={setEmbeddingConfig} />
        )}

        {/* Filters */}
        <div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {filters.length > 0 && (
              <span className="badge bg-accent-muted text-accent text-[10px]">{filters.length} active</span>
            )}
            <span className="text-gray-700 ml-1">{showFilters ? '▲' : '▼'}</span>
          </button>
          {showFilters && (
            <div className="mt-2 space-y-2 p-3 bg-surface-200 rounded-lg border border-border">
              {filters.length === 0 && (
                <p className="text-xs text-gray-600">No filters. Add one to narrow results by metadata.</p>
              )}
              {filters.map((f, idx) => (
                <div key={idx} className="flex gap-1.5 items-center">
                  <select
                    className="input py-1 text-xs flex-1"
                    value={f.path}
                    onChange={(e) => setFilters((fs) => fs.map((x, i) => i === idx ? { ...x, path: e.target.value } : x))}
                  >
                    <option value="">Field…</option>
                    {properties.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select
                    className="input py-1 text-xs w-32"
                    value={f.operator}
                    onChange={(e) => setFilters((fs) => fs.map((x, i) => i === idx ? { ...x, operator: e.target.value as FilterCondition['operator'] } : x))}
                  >
                    {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                  <input
                    className="input py-1 text-xs flex-1"
                    value={f.operator === 'IsNull' ? '' : String(f.value)}
                    placeholder={f.operator === 'IsNull' ? '—' : 'value'}
                    disabled={f.operator === 'IsNull'}
                    onChange={(e) => setFilters((fs) => fs.map((x, i) => i === idx ? { ...x, value: e.target.value } : x))}
                  />
                  <button
                    type="button"
                    onClick={() => setFilters((fs) => fs.filter((_, i) => i !== idx))}
                    className="btn-ghost p-1 text-gray-600 hover:text-red-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setFilters((fs) => [...fs, newFilter()])}
                  className="btn-ghost text-xs gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add filter
                </button>
                {filters.length > 0 && (
                  <p className="text-[10px] text-gray-600">Applied client-side to top-{topK} results</p>
                )}
              </div>
            </div>
          )}
        </div>
      </form>

      {error && (
        <div className="flex items-start gap-2 p-4 bg-red-900/20 border border-red-800 rounded text-sm text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="whitespace-pre-wrap leading-relaxed">{error}</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{results.length} results {duration !== null && `in ${duration}ms`}</p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setVizHighlight({ collectionName: className, ids: results.map((r) => r.id) }); navigate(`/collections/${className}`) }}
                className="btn-ghost text-xs gap-1"
                title="Highlight these results in the collection's 3D vector space"
              >
                <Boxes className="w-3 h-3" /> View in 3D
              </button>
              <button onClick={() => exportResults('json')} className="btn-ghost text-xs gap-1" title="Export as JSON">
                <Download className="w-3 h-3" /> JSON
              </button>
              <button onClick={() => exportResults('csv')} className="btn-ghost text-xs gap-1" title="Export as CSV">
                <Download className="w-3 h-3" /> CSV
              </button>
              <button onClick={() => setResults([])} className="btn-ghost text-xs">Clear</button>
            </div>
          </div>
          {results.map((r, i) => <ResultCard key={r.id} result={r} rank={i + 1} />)}
        </div>
      )}

      {!loading && !error && results.length === 0 && query && (
        <p className="text-center text-sm text-gray-500 py-8">No results found</p>
      )}
    </div>
  )
}
