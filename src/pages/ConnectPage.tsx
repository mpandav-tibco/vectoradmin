import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers, Loader2, AlertCircle, CheckCircle, Lock, Globe, Server, Bookmark, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { buildBaseURL } from '@/lib/weaviate/client'
import { useConnectionStore } from '@/store/connectionStore'
import { getAdapter } from '@/lib/adapters'
import type { ConnectionConfig, VectorDBType } from '@/types/domain'
import { cn } from '@/lib/utils/cn'

const DB_LABELS: Record<string, string> = {
  weaviate: 'Weaviate', qdrant: 'Qdrant', chroma: 'Chroma',
  pinecone: 'Pinecone', pgvector: 'pgvector', activespaces: 'ActiveSpaces',
}

interface DBOption {
  type: VectorDBType
  label: string
  description: string
  defaultPort: number
  available: boolean
}

const DB_OPTIONS: DBOption[] = [
  { type: 'weaviate', label: 'Weaviate', description: 'Open-source vector database', defaultPort: 8080, available: true },
  { type: 'qdrant', label: 'Qdrant', description: 'High-performance vector search', defaultPort: 6333, available: true },
  { type: 'chroma', label: 'Chroma', description: 'AI-native embedding store', defaultPort: 8000, available: true },
  { type: 'pinecone', label: 'Pinecone', description: 'Managed vector database', defaultPort: 443, available: true },
  { type: 'pgvector', label: 'pgvector', description: 'PostgreSQL vector extension', defaultPort: 5432, available: false },
  { type: 'activespaces', label: 'ActiveSpaces', description: 'TIBCO in-memory data grid', defaultPort: 9000, available: false },
]

const DEFAULT_PROXY: Partial<Record<VectorDBType, string>> = {
  weaviate: '/api/weaviate',
  qdrant: '/api/qdrant',
  chroma: '/api/chroma',
}

export function ConnectPage() {
  const navigate = useNavigate()
  const { setConfig, setStatus, savedConnections, saveConnection, deleteConnection } = useConnectionStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ConnectionConfig>({
    dbType: 'weaviate',
    host: 'localhost',
    port: 8080,
    scheme: 'http',
    apiKey: '',
    proxyURL: '/api/weaviate',
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showSaved, setShowSaved] = useState(savedConnections.length > 0)

  const selectedDB = DB_OPTIONS.find((d) => d.type === form.dbType) ?? DB_OPTIONS[0]

  const isPinecone = form.dbType === 'pinecone'

  const handleDBSelect = (opt: DBOption) => {
    if (!opt.available) return
    setForm((f) => ({
      ...f,
      dbType: opt.type,
      port: opt.defaultPort,
      proxyURL: DEFAULT_PROXY[opt.type] ?? '',
      scheme: opt.type === 'pinecone' ? 'https' : f.scheme,
      host: opt.type === 'pinecone' ? '' : f.host,
    }))
    setError(null)
  }

  const connectWith = async (cfg: ConnectionConfig) => {
    setLoading(true)
    setError(null)
    setConfig(cfg)
    try {
      const health = await getAdapter(cfg).checkHealth()
      if (health.ready) {
        setStatus('connected', undefined, health.version)
        saveConnection(cfg)
        navigate('/')
      } else {
        setStatus('error', health.error)
        setError(health.error ?? `Could not connect to ${DB_LABELS[cfg.dbType] ?? cfg.dbType}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      setStatus('error', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = (e: React.FormEvent) => { e.preventDefault(); connectWith(form) }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-accent-muted mb-4">
            <Layers className="w-7 h-7 text-accent" />
          </div>
          <h1 className="text-2xl font-bold text-gray-100">Vector Admin UI</h1>
          <p className="mt-1 text-gray-400 text-sm">Connect to your vector database</p>
        </div>

        <div className="card p-6 space-y-5">
          {/* DB type selector */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">Database</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {DB_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => handleDBSelect(opt)}
                  disabled={!opt.available}
                  title={opt.available ? opt.description : `${opt.label} — coming soon`}
                  className={cn(
                    'relative flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors',
                    form.dbType === opt.type
                      ? 'border-accent bg-accent-muted text-accent'
                      : opt.available
                      ? 'border-border bg-surface-200 text-gray-300 hover:border-gray-500 hover:text-gray-100'
                      : 'border-border bg-surface-200 text-gray-600 cursor-not-allowed opacity-50'
                  )}
                >
                  {!opt.available && (
                    <Lock className="absolute top-1.5 right-1.5 w-2.5 h-2.5 text-gray-600" />
                  )}
                  <span className="text-center leading-tight">{opt.label}</span>
                  {form.dbType === opt.type && (
                    <CheckCircle className="w-3 h-3" />
                  )}
                </button>
              ))}
            </div>
            {!selectedDB.available && (
              <p className="mt-1.5 text-xs text-gray-500">{selectedDB.label} support is planned for a future release.</p>
            )}
          </div>

          <form onSubmit={handleConnect} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  {isPinecone ? 'Index Host' : 'Host'}
                </label>
                <input
                  className="input"
                  value={form.host}
                  onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                  placeholder={isPinecone ? 'my-index-abc123.svc.aped-1234.pinecone.io' : 'localhost'}
                  required
                />
                {isPinecone && (
                  <p className="mt-1 text-xs text-gray-600">
                    Find the index host in your <span className="text-gray-400">Pinecone console → Indexes → your index → Host</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Port</label>
                <input
                  className="input"
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Scheme</label>
              <div className="flex gap-2">
                {(['http', 'https'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, scheme: s }))}
                    className={cn(
                      'flex-1 py-1.5 rounded text-sm font-medium border transition-colors',
                      form.scheme === s
                        ? 'bg-accent border-accent text-white'
                        : 'bg-surface-200 border-border text-gray-400 hover:text-gray-100'
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                API Key {isPinecone ? <span className="text-red-400">*</span> : <span className="text-gray-600">(optional)</span>}
              </label>
              <input
                className="input font-mono"
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder={isPinecone ? 'Pinecone API key' : 'Leave blank for anonymous access'}
                required={isPinecone}
              />
            </div>

            {/* Advanced / proxy */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                <Globe className="w-3.5 h-3.5" />
                Advanced — proxy settings
                <span className="text-gray-700">{showAdvanced ? '▲' : '▼'}</span>
              </button>
              {showAdvanced && (
                <div className="mt-2 space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                      Proxy URL
                    </label>
                    <input
                      className="input font-mono text-sm"
                      value={form.proxyURL ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, proxyURL: e.target.value }))}
                      placeholder="/api/weaviate"
                    />
                    <p className="mt-1 text-xs text-gray-600">
                      <code className="font-mono text-gray-500">/api/weaviate</code> routes through the built-in proxy (avoids CORS — recommended for local).
                      Set a full URL (e.g. <code className="font-mono text-gray-500">https://proxy.example.com</code>) for remote instances.
                      Clear to connect directly to the host above.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Effective URL preview */}
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-300 rounded text-xs font-mono text-gray-400">
              <Server className="w-3.5 h-3.5 flex-shrink-0 text-gray-600" />
              <span className="truncate">{buildBaseURL(form)}</span>
              {form.proxyURL?.startsWith('/') && (
                <span className="ml-auto text-gray-600 font-sans whitespace-nowrap">→ {form.scheme}://{form.host}:{form.port}</span>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-800 rounded-md text-sm text-red-400">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? 'Connecting…' : `Connect to ${selectedDB.label}`}
            </button>
          </form>

          <div className="pt-1 border-t border-border">
            <p className="text-xs text-gray-500 text-center">
              {isPinecone ? (
                <>Create a free index at <span className="text-gray-400">app.pinecone.io</span> — no local setup needed</>
              ) : (
                <>Start locally: <code className="font-mono text-gray-400">docker compose{form.dbType !== 'weaviate' ? ` --profile ${form.dbType}` : ''} up -d</code></>
              )}
            </p>
          </div>

          {/* Saved connections */}
          {savedConnections.length > 0 && (
            <div className="border-t border-border pt-3 space-y-2">
              <button
                type="button"
                onClick={() => setShowSaved((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors w-full"
              >
                <Bookmark className="w-3.5 h-3.5" />
                Saved connections ({savedConnections.length})
                {showSaved ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
              </button>
              {showSaved && (
                <div className="space-y-1.5">
                  {savedConnections.map((sc, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-surface-200 rounded-lg border border-border">
                      <span className="text-[10px] font-medium text-accent bg-accent-muted rounded px-1.5 py-0.5 flex-shrink-0">
                        {DB_LABELS[sc.dbType] ?? sc.dbType}
                      </span>
                      <span className="text-xs text-gray-300 truncate flex-1" title={sc.label}>{sc.label}</span>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => connectWith(sc)}
                        className="text-xs text-accent hover:text-accent/80 font-medium flex-shrink-0"
                      >
                        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Connect'}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteConnection(idx)}
                        className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0"
                        title="Remove saved connection"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
