import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, ChevronRight, Loader2, Database, X, GripVertical, Info } from 'lucide-react'
import { useCollections, useObjectCount, useCreateCollection, useDeleteCollection } from '@/hooks/useCollections'
import { useConnectionStore } from '@/store/connectionStore'
import { formatNumber } from '@/lib/utils/format'
import type { CreateCollectionInput } from '@/lib/adapters'
import { cn } from '@/lib/utils/cn'

function ObjectCount({ name }: { name: string }) {
  const { data } = useObjectCount(name)
  return <span>{data !== undefined ? formatNumber(data) : '…'}</span>
}

// ── Wizard helpers ─────────────────────────────────────────────────────────────

const PRESETS = [
  {
    label: 'Articles',
    description: 'News articles and blog posts',
    distance: 'cosine' as const,
    dims: 768,
    props: [
      { name: 'title', dataType: 'text' },
      { name: 'content', dataType: 'text' },
      { name: 'author', dataType: 'text' },
      { name: 'url', dataType: 'text' },
      { name: 'tags', dataType: 'text[]' },
    ],
  },
  {
    label: 'Products',
    description: 'Product catalog with descriptions',
    distance: 'cosine' as const,
    dims: 768,
    props: [
      { name: 'name', dataType: 'text' },
      { name: 'description', dataType: 'text' },
      { name: 'category', dataType: 'text' },
      { name: 'price', dataType: 'number' },
    ],
  },
  {
    label: 'Feedback',
    description: 'Customer reviews and support tickets',
    distance: 'cosine' as const,
    dims: 768,
    props: [
      { name: 'text', dataType: 'text' },
      { name: 'sentiment', dataType: 'text' },
      { name: 'rating', dataType: 'int' },
      { name: 'category', dataType: 'text' },
    ],
  },
  {
    label: 'Knowledge',
    description: 'Docs and FAQ chunks for RAG',
    distance: 'cosine' as const,
    dims: 768,
    props: [
      { name: 'content', dataType: 'text' },
      { name: 'section', dataType: 'text' },
      { name: 'source', dataType: 'text' },
    ],
  },
]

const DATA_TYPES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'text',    label: 'Text',    hint: 'Searchable string (BM25 + keyword)' },
  { value: 'int',     label: 'Integer', hint: 'Whole number — filterable' },
  { value: 'number',  label: 'Number',  hint: 'Decimal / float — filterable' },
  { value: 'boolean', label: 'Boolean', hint: 'True / false flag' },
  { value: 'date',    label: 'Date',    hint: 'ISO 8601 datetime string' },
  { value: 'uuid',    label: 'UUID',    hint: 'Cross-reference identifier' },
  { value: 'text[]',  label: 'Text[ ]', hint: 'Array of strings (e.g. tags)' },
]

const DIM_PRESETS = [
  { label: 'nomic', dims: 768 },
  { label: 'MiniLM', dims: 384 },
  { label: 'mxbai', dims: 1024 },
  { label: '3-small', dims: 1536 },
  { label: '3-large', dims: 3072 },
]

const DISTANCE_INFO: Record<string, string> = {
  cosine: 'Best for text — measures angle between vectors',
  dot: 'Use with inner-product trained models (e.g. OpenAI)',
  euclidean: 'Straight-line distance — good for image / audio',
}

const DB_BADGE: Record<string, string> = {
  weaviate: 'bg-indigo-900/40 text-indigo-300',
  qdrant:   'bg-orange-900/40 text-orange-300',
  chroma:   'bg-pink-900/40 text-pink-300',
  pinecone: 'bg-green-900/40 text-green-300',
}

// ── Wizard modal ───────────────────────────────────────────────────────────────

function CreateCollectionModal({ onClose }: { onClose: () => void }) {
  const create = useCreateCollection()
  const config = useConnectionStore((s) => s.config)
  const dbType = config?.dbType ?? 'weaviate'

  const isWeaviate = dbType === 'weaviate'
  const isPinecone = dbType === 'pinecone'
  const schemaFree = !isWeaviate

  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [distance, setDistance] = useState<CreateCollectionInput['distance']>('cosine')
  const [dimensions, setDimensions] = useState(768)
  const [props, setProps] = useState([{ name: 'content', dataType: 'text' }])
  const [nameError, setNameError] = useState('')

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    const safeName = isWeaviate
      ? preset.label.replace(/\s+/g, '')
      : preset.label.toLowerCase().replace(/\s+/g, '_')
    setName(safeName)
    setDesc(preset.description)
    setDistance(preset.distance)
    setDimensions(preset.dims)
    setProps(preset.props)
    setNameError('')
  }

  const validateName = (v: string) => {
    if (!v) { setNameError('Name is required'); return false }
    if (isWeaviate && !/^[A-Z]/.test(v)) { setNameError('Weaviate names must start with uppercase'); return false }
    setNameError('')
    return true
  }

  const addProp = () => setProps((p) => [...p, { name: '', dataType: 'text' }])
  const removeProp = (i: number) => setProps((p) => p.filter((_, j) => j !== i))
  const updateProp = (i: number, patch: Partial<{ name: string; dataType: string }>) =>
    setProps((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  const dupNames = new Set(
    props.map((p) => p.name).filter((n, i, arr) => n && arr.indexOf(n) !== i)
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateName(name)) return
    const validProps = props.filter((p) => p.name && !dupNames.has(p.name))
    const input: CreateCollectionInput = {
      name,
      description: desc || undefined,
      distance,
      vectorDimensions: isPinecone ? undefined : dimensions,
      properties: validProps.length ? validProps : undefined,
    }
    await create.mutateAsync(input)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="card w-full max-w-xl my-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-gray-100">New Collection</h3>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium capitalize',
              DB_BADGE[dbType] ?? 'bg-surface-300 text-gray-400')}>
              {dbType}
            </span>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Quick templates */}
          <div>
            <p className="text-xs text-gray-500 mb-2">Start from a template</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => applyPreset(p)}
                  title={p.description}
                  className="text-xs px-3 py-1.5 rounded-full border border-border bg-surface-200 text-gray-300 hover:border-accent hover:text-accent transition-colors">
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Name + description */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                {isWeaviate ? 'Class Name' : 'Collection Name'} <span className="text-red-400">*</span>
              </label>
              <input
                className={cn('input', nameError && 'border-red-600')}
                value={name}
                onChange={(e) => { setName(e.target.value); if (nameError) validateName(e.target.value) }}
                onBlur={(e) => validateName(e.target.value)}
                placeholder={isWeaviate ? 'Documents' : 'documents'}
                required
              />
              {nameError
                ? <p className="text-xs text-red-400 mt-1">{nameError}</p>
                : isWeaviate && <p className="text-xs text-gray-600 mt-1">Must start with an uppercase letter</p>
              }
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Description</label>
              <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)}
                placeholder="Optional" />
            </div>
          </div>

          {/* Vector config */}
          {!isPinecone && (
            <div className="p-4 bg-surface-200 rounded-lg border border-border space-y-3">
              <p className="text-xs font-medium text-gray-400">Vector Configuration</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Distance Metric</label>
                  <select className="input text-sm" value={distance}
                    onChange={(e) => setDistance(e.target.value as CreateCollectionInput['distance'])}>
                    <option value="cosine">Cosine</option>
                    <option value="dot">Dot Product</option>
                    <option value="euclidean">Euclidean</option>
                  </select>
                  <p className="text-xs text-gray-600 mt-1 leading-snug">{DISTANCE_INFO[distance ?? 'cosine']}</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Dimensions</label>
                  <input type="number" className="input text-sm" value={dimensions}
                    onChange={(e) => setDimensions(Number(e.target.value))} min={1} max={65536} />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {DIM_PRESETS.map((d) => (
                      <button key={d.dims} type="button" onClick={() => setDimensions(d.dims)}
                        title={`${d.dims} dimensions`}
                        className={cn('text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                          dimensions === d.dims
                            ? 'border-accent text-accent bg-accent-muted'
                            : 'border-border text-gray-600 hover:text-gray-300 hover:border-gray-500')}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {isPinecone && (
            <div className="flex items-start gap-2 p-3 bg-surface-200 rounded-lg border border-border text-xs text-gray-500">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-600" />
              Pinecone namespaces are created implicitly on first write. Dimensions and distance are set when creating the index in the Pinecone console.
            </div>
          )}

          {/* Schema / fields builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-400">
                  {isWeaviate ? 'Properties' : 'Fields'}
                </label>
                {schemaFree && (
                  <span className="text-xs text-gray-600">optional — {dbType} is schema-free</span>
                )}
              </div>
              <button type="button" onClick={addProp} className="btn-ghost text-xs gap-1">
                <Plus className="w-3 h-3" /> Add field
              </button>
            </div>

            {schemaFree && (
              <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                Fields are stored as metadata and used for display and search filtering. The database does not enforce this schema — you can always ingest additional fields.
              </p>
            )}

            <div className="space-y-2">
              {props.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <GripVertical className="w-3.5 h-3.5 text-gray-700 flex-shrink-0 cursor-grab" />
                  <input
                    className={cn('input flex-1 text-sm font-mono', dupNames.has(p.name) && 'border-yellow-600')}
                    placeholder="field_name"
                    value={p.name}
                    onChange={(e) => updateProp(i, { name: e.target.value })}
                  />
                  <select
                    className="input w-32 text-sm"
                    value={p.dataType}
                    title={DATA_TYPES.find((t) => t.value === p.dataType)?.hint}
                    onChange={(e) => updateProp(i, { dataType: e.target.value })}>
                    {DATA_TYPES.map((t) => (
                      <option key={t.value} value={t.value} title={t.hint}>{t.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeProp(i)}
                    className="btn-ghost p-1.5 text-gray-600 hover:text-red-400 flex-shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {dupNames.size > 0 && (
              <p className="text-xs text-yellow-500 mt-2">
                Duplicate names will be skipped: {[...dupNames].join(', ')}
              </p>
            )}
          </div>

          {create.error && (
            <p className="text-xs text-red-400">{(create.error as Error).message}</p>
          )}

          <div className="flex justify-end gap-2 pt-1 border-t border-border">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={create.isPending} className="btn-primary">
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Collection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Collections list ───────────────────────────────────────────────────────────

export function CollectionsPage() {
  const navigate = useNavigate()
  const { data: collections, isLoading } = useCollections()
  const deleteCollection = useDeleteCollection()
  const [showCreate, setShowCreate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">Collections</h2>
          <p className="text-sm text-gray-500">{collections?.length ?? 0} collections</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary" title="Create a new collection">
          <Plus className="w-4 h-4" /> New Collection
        </button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>
      )}

      {!isLoading && !collections?.length && (
        <div className="card p-12 text-center">
          <Database className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400">No collections yet</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">Create your first collection</button>
        </div>
      )}

      <div className="space-y-2">
        {collections?.map((col) => (
          <div key={col.name} className="card flex items-center justify-between p-4 hover:bg-surface-200 transition-colors group">
            <button onClick={() => navigate(`/collections/${col.name}`)} className="flex items-center gap-3 flex-1 min-w-0">
              <Database className="w-4 h-4 text-accent flex-shrink-0" />
              <div className="text-left min-w-0">
                <p className="font-medium text-gray-100 font-mono">{col.name}</p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {col.description || `${col.properties?.length ?? 0} properties · ${col.distance ?? 'cosine'}`}
                </p>
              </div>
              <div className="ml-auto mr-4 text-right flex-shrink-0">
                <p className="text-xs text-gray-500"><ObjectCount name={col.name} /> objects</p>
                {col.vectorDimensions && <p className="text-xs text-gray-600">{col.vectorDimensions}d</p>}
              </div>
            </button>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => navigate(`/collections/${col.name}`)} title="Browse objects and schema" className="btn-ghost p-1.5">
                <ChevronRight className="w-4 h-4" />
              </button>
              <button onClick={() => setConfirmDelete(col.name)} title="Delete collection permanently" className="btn-ghost p-1.5 text-red-500 hover:text-red-400">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showCreate && <CreateCollectionModal onClose={() => setShowCreate(false)} />}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card p-6 max-w-sm w-full space-y-4">
            <h3 className="font-semibold text-gray-100">Delete Collection</h3>
            <p className="text-sm text-gray-400">
              Are you sure you want to delete <span className="font-mono text-red-400">{confirmDelete}</span>?
              This will permanently delete all objects.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={async () => { await deleteCollection.mutateAsync(confirmDelete); setConfirmDelete(null) }}
                disabled={deleteCollection.isPending}
                className="btn-danger"
              >
                {deleteCollection.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
