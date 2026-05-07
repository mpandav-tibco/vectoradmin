import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle, AlertCircle, Loader2, Trash2, RefreshCw, Pencil, Plus,
  ChevronDown, ChevronUp, Globe, Server, Lock, X, Download, Upload, Cpu,
} from 'lucide-react'
import { useConnectionStore } from '@/store/connectionStore'
import type { SavedConnection } from '@/store/connectionStore'
import { useAppStore } from '@/store/appStore'
import { getAdapter } from '@/lib/adapters'
import { buildBaseURL } from '@/lib/weaviate/client'
import type { ConnectionConfig, VectorDBType, EmbeddingConfig, EmbeddingProvider } from '@/types/domain'
import { cn } from '@/lib/utils/cn'

const DB_LABELS: Record<string, string> = {
  weaviate: 'Weaviate', qdrant: 'Qdrant', chroma: 'Chroma',
  pinecone: 'Pinecone', pgvector: 'pgvector', activespaces: 'ActiveSpaces',
}

const DB_COLORS: Record<string, string> = {
  weaviate: 'bg-green-900/40 text-green-400',
  qdrant:   'bg-red-900/40 text-red-400',
  chroma:   'bg-orange-900/40 text-orange-400',
  pinecone: 'bg-blue-900/40 text-blue-400',
  pgvector: 'bg-sky-900/40 text-sky-400',
}

const EMBED_PROVIDERS: EmbeddingProvider[] = ['ollama', 'openai', 'cohere', 'custom']

interface DBOption { type: VectorDBType; label: string; description: string; defaultPort: number; available: boolean }

const DB_OPTIONS: DBOption[] = [
  { type: 'weaviate', label: 'Weaviate', description: 'Open-source vector database', defaultPort: 8080, available: true },
  { type: 'qdrant',   label: 'Qdrant',   description: 'High-performance vector search', defaultPort: 6333, available: true },
  { type: 'chroma',   label: 'Chroma',   description: 'AI-native embedding store', defaultPort: 8000, available: true },
  { type: 'pinecone', label: 'Pinecone', description: 'Managed vector database', defaultPort: 443, available: true },
  { type: 'pgvector', label: 'pgvector', description: 'PostgreSQL + PostgREST', defaultPort: 3000, available: true },
  { type: 'activespaces', label: 'ActiveSpaces', description: 'TIBCO in-memory data grid', defaultPort: 9000, available: false },
]

const DEFAULT_PROXY: Partial<Record<VectorDBType, string>> = {
  weaviate: '/api/weaviate', qdrant: '/api/qdrant',
  chroma: '/api/chroma',    pgvector: '/api/pgvector',
}

type HealthState = 'unchecked' | 'ok' | 'error'

const defaultEmbed = (): EmbeddingConfig => ({ provider: 'ollama', model: 'nomic-embed-text', baseURL: '' })

export function ConnectionsPage() {
  const navigate = useNavigate()
  const { config, savedConnections, saveConnection, updateConnection, deleteConnection, setConfig, setStatus } =
    useConnectionStore()
  const { setEmbeddingConfig } = useAppStore()

  // Per-row health state
  const [healthMap, setHealthMap] = useState<Record<number, HealthState>>({})
  const [healthMsg, setHealthMsg] = useState<Record<number, string>>({})
  const [testingIdx, setTestingIdx] = useState<number | null>(null)

  // Inline label editing
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [labelDraft, setLabelDraft] = useState('')

  // Per-row embedding config panel
  const [embedExpandIdx, setEmbedExpandIdx] = useState<number | null>(null)
  const [embedDraft, setEmbedDraft] = useState<EmbeddingConfig>(defaultEmbed())

  // Activate (switch to) a saved connection
  const [activatingIdx, setActivatingIdx] = useState<number | null>(null)

  // Add new connection form
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<ConnectionConfig>({
    dbType: 'weaviate', host: 'localhost', port: 8080,
    scheme: 'http', apiKey: '', proxyURL: '/api/weaviate',
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  // ── per-row actions ────────────────────────────────────────────────────────

  const testConnection = async (idx: number) => {
    setTestingIdx(idx)
    setHealthMap((m) => ({ ...m, [idx]: 'unchecked' }))
    try {
      const h = await getAdapter(savedConnections[idx]).checkHealth()
      setHealthMap((m) => ({ ...m, [idx]: h.ready ? 'ok' : 'error' }))
      setHealthMsg((m) => ({ ...m, [idx]: h.ready ? (h.version ?? 'connected') : (h.error ?? 'not ready') }))
    } catch (e) {
      setHealthMap((m) => ({ ...m, [idx]: 'error' }))
      setHealthMsg((m) => ({ ...m, [idx]: e instanceof Error ? e.message : 'failed' }))
    } finally {
      setTestingIdx(null)
    }
  }

  const activateConnection = async (idx: number) => {
    setActivatingIdx(idx)
    const sc = savedConnections[idx]
    setConfig(sc)
    try {
      const h = await getAdapter(sc).checkHealth()
      if (h.ready) {
        setStatus('connected', undefined, h.version)
        // Sync embedding config from this connection profile if one is saved
        if (sc.embeddingConfig) setEmbeddingConfig(sc.embeddingConfig)
        navigate('/')
      } else {
        setStatus('error', h.error)
      }
    } catch (e) {
      setStatus('error', e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setActivatingIdx(null)
    }
  }

  const commitLabel = (idx: number) => {
    if (labelDraft.trim()) updateConnection(idx, { label: labelDraft.trim() })
    setEditingIdx(null)
  }

  const openEmbedPanel = (idx: number) => {
    if (embedExpandIdx === idx) { setEmbedExpandIdx(null); return }
    setEmbedDraft(savedConnections[idx].embeddingConfig ?? defaultEmbed())
    setEmbedExpandIdx(idx)
  }

  const saveEmbedding = (idx: number) => {
    updateConnection(idx, { embeddingConfig: embedDraft })
    setEmbedExpandIdx(null)
  }

  // ── add form ───────────────────────────────────────────────────────────────

  const handleDBSelect = (opt: DBOption) => {
    if (!opt.available) return
    setAddForm((f) => ({
      ...f, dbType: opt.type, port: opt.defaultPort,
      proxyURL: DEFAULT_PROXY[opt.type] ?? '',
      scheme: opt.type === 'pinecone' ? 'https' : f.scheme,
      host: opt.type === 'pinecone' ? '' : f.host,
    }))
    setSaveError(null)
    setSaveOk(false)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      const h = await getAdapter(addForm).checkHealth()
      if (!h.ready) {
        setSaveError(h.error ?? 'Connection refused — check host and port.')
      } else {
        saveConnection(addForm)
        setSaveOk(true)
        setTimeout(() => { setShowAdd(false); setSaveOk(false) }, 1200)
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setSaving(false)
    }
  }

  const isPinecone = addForm.dbType === 'pinecone'

  // ── export / import ────────────────────────────────────────────────────────
  const importRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const exportConnections = () => {
    const blob = new Blob([JSON.stringify(savedConnections, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'connections.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importConnections = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as SavedConnection[]
        if (!Array.isArray(parsed)) throw new Error('Expected a JSON array')
        let added = 0
        for (const sc of parsed) {
          if (!sc.dbType || !sc.host) continue
          saveConnection(sc, sc.label)
          added++
        }
        setImportMsg(`Imported ${added} connection${added === 1 ? '' : 's'} (duplicates merged).`)
        setTimeout(() => setImportMsg(null), 4000)
      } catch (err) {
        setImportMsg(`Import failed: ${err instanceof Error ? err.message : 'invalid file'}`)
        setTimeout(() => setImportMsg(null), 5000)
      }
      if (importRef.current) importRef.current.value = ''
    }
    reader.readAsText(file)
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">Saved Connections</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage all saved connections. Embedding config is saved per-connection and auto-loaded when you switch.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0 mt-0.5">
          <button
            type="button"
            onClick={exportConnections}
            disabled={savedConnections.length === 0}
            title="Download all saved connections as connections.json"
            className="btn-ghost text-xs disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            title="Import connections from a previously exported connections.json"
            className="btn-ghost text-xs"
          >
            <Upload className="w-3.5 h-3.5" /> Import
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={importConnections}
          />
        </div>
      </div>

      {/* Import feedback */}
      {importMsg && (
        <div className={cn(
          'px-3 py-2 rounded text-xs flex items-center gap-2',
          importMsg.startsWith('Import failed')
            ? 'bg-red-900/20 border border-red-800 text-red-400'
            : 'bg-green-900/20 border border-green-800 text-green-400'
        )}>
          {importMsg.startsWith('Import failed')
            ? <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            : <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
          }
          {importMsg}
        </div>
      )}

      {/* Saved connection list */}
      {savedConnections.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-500">
          No saved connections yet — connect to a database to save it, or add one below.
        </div>
      ) : (
        <div className="card overflow-hidden">
          {savedConnections.map((sc, idx) => {
            const isActive = config?.host === sc.host && config?.port === sc.port && config?.dbType === sc.dbType
            const health = healthMap[idx]
            const embedOpen = embedExpandIdx === idx
            const hasEmbed = !!sc.embeddingConfig
            return (
              <div key={idx} className="border-b border-border last:border-b-0">
                {/* Main row */}
                <div className="px-4 py-3 flex items-center gap-3">
                  {/* DB badge */}
                  <span className={cn('text-[10px] font-semibold rounded px-1.5 py-0.5 flex-shrink-0', DB_COLORS[sc.dbType] ?? 'bg-surface-300 text-gray-400')}>
                    {DB_LABELS[sc.dbType] ?? sc.dbType}
                  </span>

                  {/* Label / host */}
                  <div className="flex-1 min-w-0">
                    {editingIdx === idx ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          className="input py-0.5 text-sm h-7 flex-1"
                          value={labelDraft}
                          onChange={(e) => setLabelDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitLabel(idx); if (e.key === 'Escape') setEditingIdx(null) }}
                        />
                        <button type="button" onClick={() => commitLabel(idx)} className="text-accent text-xs hover:text-accent/80">Save</button>
                        <button type="button" onClick={() => setEditingIdx(null)}><X className="w-3.5 h-3.5 text-gray-500" /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 group">
                        <span className="text-sm text-gray-200 truncate font-mono">{sc.label}</span>
                        {isActive && <span className="text-[10px] text-accent bg-accent-muted px-1.5 py-0.5 rounded">active</span>}
                        <button
                          type="button"
                          onClick={() => { setEditingIdx(idx); setLabelDraft(sc.label) }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Pencil className="w-3 h-3 text-gray-500 hover:text-gray-300" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Health indicator */}
                  {health === 'ok' && (
                    <span className="text-xs text-green-400 flex items-center gap-1 flex-shrink-0">
                      <CheckCircle className="w-3 h-3" /> {healthMsg[idx]}
                    </span>
                  )}
                  {health === 'error' && (
                    <span className="text-xs text-red-400 flex items-center gap-1 flex-shrink-0 max-w-[140px] truncate" title={healthMsg[idx]}>
                      <AlertCircle className="w-3 h-3 flex-shrink-0" /> {healthMsg[idx]}
                    </span>
                  )}

                  {/* Embedding config toggle */}
                  <button
                    type="button"
                    onClick={() => openEmbedPanel(idx)}
                    title={hasEmbed ? `Embedding: ${sc.embeddingConfig?.provider} / ${sc.embeddingConfig?.model}` : 'Set embedding config for this connection'}
                    className={cn(
                      'btn-ghost p-1.5 text-xs flex-shrink-0 rounded',
                      embedOpen ? 'text-accent bg-accent-muted' : hasEmbed ? 'text-accent/70' : 'text-gray-600'
                    )}
                  >
                    <Cpu className="w-3.5 h-3.5" />
                  </button>

                  {/* Test */}
                  <button
                    type="button"
                    onClick={() => testConnection(idx)}
                    disabled={testingIdx === idx}
                    className="btn-ghost text-xs flex-shrink-0"
                    title="Test connection"
                  >
                    {testingIdx === idx
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>

                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => activateConnection(idx)}
                      disabled={activatingIdx === idx}
                      className="btn-primary text-xs px-3 py-1 flex-shrink-0"
                    >
                      {activatingIdx === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Use'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => deleteConnection(idx)}
                    className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0"
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Embedding config panel */}
                {embedOpen && (
                  <div className="px-4 py-4 bg-surface-200 border-t border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5" /> Embedding provider
                      </p>
                      <p className="text-xs text-gray-600">Loaded automatically when you switch to this connection</p>
                    </div>

                    {/* Provider selector */}
                    <div className="flex gap-1.5 flex-wrap">
                      {EMBED_PROVIDERS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setEmbedDraft((d) => ({ ...d, provider: p }))}
                          className={cn(
                            'px-2.5 py-1 rounded text-xs font-medium border transition-colors',
                            embedDraft.provider === p
                              ? 'bg-accent border-accent text-white'
                              : 'bg-surface-300 border-border text-gray-400 hover:text-gray-100'
                          )}
                        >
                          {p}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Model</label>
                        <input
                          className="input text-xs"
                          value={embedDraft.model}
                          onChange={(e) => setEmbedDraft((d) => ({ ...d, model: e.target.value }))}
                          placeholder={embedDraft.provider === 'openai' ? 'text-embedding-3-small' : 'nomic-embed-text'}
                        />
                      </div>
                      {(embedDraft.provider === 'ollama' || embedDraft.provider === 'custom') && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Base URL</label>
                          <input
                            className="input text-xs font-mono"
                            value={embedDraft.baseURL ?? ''}
                            onChange={(e) => setEmbedDraft((d) => ({ ...d, baseURL: e.target.value }))}
                            placeholder="http://localhost:11434"
                          />
                        </div>
                      )}
                      {(embedDraft.provider === 'openai' || embedDraft.provider === 'cohere' || embedDraft.provider === 'custom') && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">API Key</label>
                          <input
                            className="input text-xs font-mono"
                            type="password"
                            value={embedDraft.apiKey ?? ''}
                            onChange={(e) => setEmbedDraft((d) => ({ ...d, apiKey: e.target.value }))}
                            placeholder="sk-…"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => { updateConnection(idx, { embeddingConfig: undefined }); setEmbedExpandIdx(null) }}
                        className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                        title="Clear saved embedding config for this connection"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmbedExpandIdx(null)}
                        className="btn-secondary text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEmbedding(idx)}
                        className="btn-primary text-xs"
                        disabled={!embedDraft.model.trim()}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add connection toggle */}
      <button
        type="button"
        onClick={() => { setShowAdd((v) => !v); setSaveError(null); setSaveOk(false) }}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-100 transition-colors"
      >
        <Plus className="w-4 h-4" />
        {showAdd ? 'Cancel' : 'Add connection'}
        {showAdd ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {/* Add form */}
      {showAdd && (
        <div className="card p-5 space-y-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">New connection</p>

          {/* DB selector */}
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
                    addForm.dbType === opt.type
                      ? 'border-accent bg-accent-muted text-accent'
                      : opt.available
                      ? 'border-border bg-surface-200 text-gray-300 hover:border-gray-500 hover:text-gray-100'
                      : 'border-border bg-surface-200 text-gray-600 cursor-not-allowed opacity-50'
                  )}
                >
                  {!opt.available && <Lock className="absolute top-1.5 right-1.5 w-2.5 h-2.5 text-gray-600" />}
                  <span className="text-center leading-tight">{opt.label}</span>
                  {addForm.dbType === opt.type && <CheckCircle className="w-3 h-3" />}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  {isPinecone ? 'Index Host' : 'Host'}
                </label>
                <input
                  className="input"
                  value={addForm.host}
                  onChange={(e) => setAddForm((f) => ({ ...f, host: e.target.value }))}
                  placeholder={isPinecone ? 'my-index-abc123.svc.aped-1234.pinecone.io' : 'localhost'}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Port</label>
                <input
                  className="input"
                  type="number"
                  value={addForm.port}
                  onChange={(e) => setAddForm((f) => ({ ...f, port: Number(e.target.value) }))}
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
                    onClick={() => setAddForm((f) => ({ ...f, scheme: s }))}
                    className={cn(
                      'flex-1 py-1.5 rounded text-sm font-medium border transition-colors',
                      addForm.scheme === s
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
                value={addForm.apiKey}
                onChange={(e) => setAddForm((f) => ({ ...f, apiKey: e.target.value }))}
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
                <div className="mt-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1">Proxy URL</label>
                  <input
                    className="input font-mono text-sm"
                    value={addForm.proxyURL ?? ''}
                    onChange={(e) => setAddForm((f) => ({ ...f, proxyURL: e.target.value }))}
                    placeholder="/api/weaviate"
                  />
                </div>
              )}
            </div>

            {/* URL preview */}
            <div className="flex items-center gap-2 px-3 py-2 bg-surface-300 rounded text-xs font-mono text-gray-400">
              <Server className="w-3.5 h-3.5 flex-shrink-0 text-gray-600" />
              <span className="truncate">{buildBaseURL(addForm)}</span>
            </div>

            {saveError && (
              <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-800 rounded-md text-sm text-red-400">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                {saveError}
              </div>
            )}

            {saveOk && (
              <div className="flex items-center gap-2 p-3 bg-green-900/20 border border-green-800 rounded-md text-sm text-green-400">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                Connection saved — use the <Cpu className="w-3.5 h-3.5 inline" /> button to set its embedding config.
              </div>
            )}

            <button type="submit" disabled={saving} className="btn-primary w-full justify-center py-2">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Testing…</> : 'Test & Save'}
            </button>
            <p className="text-xs text-gray-600 text-center">
              This saves the connection without switching to it — useful for setting up Transfer targets.
            </p>
          </form>
        </div>
      )}
    </div>
  )
}
