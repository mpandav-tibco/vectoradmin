import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, RefreshCw, Eye, ChevronLeft, ChevronRight, Loader2, Copy } from 'lucide-react'
import { useCollection, useObjectCount } from '@/hooks/useCollections'
import { useObjects, useCreateObject, useDeleteObject } from '@/hooks/useObjects'
import { formatNumber, formatDate, truncate } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'
import type { DBObject } from '@/lib/adapters'

function VectorPreview({ vector }: { vector: number[] }) {
  const preview = vector.slice(0, 20)
  const max = Math.max(...preview.map(Math.abs))
  return (
    <div className="flex items-end gap-0.5 h-6">
      {preview.map((v, i) => (
        <div
          key={i}
          className={cn('w-1.5 rounded-sm', v >= 0 ? 'bg-accent' : 'bg-red-500')}
          style={{ height: `${Math.abs(v / max) * 100}%`, minHeight: '2px', opacity: 0.7 }}
          title={v.toFixed(4)}
        />
      ))}
      {vector.length > 20 && <span className="text-gray-600 text-xs ml-1">+{vector.length - 20}</span>}
    </div>
  )
}

function ObjectDetailModal({ obj, onClose, onDelete }: {
  obj: { id: string; class: string; properties: Record<string, unknown>; vector?: number[] }
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'properties' | 'raw' | 'vector'>('properties')

  const copy = () => {
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] bg-surface-100 border border-border rounded-xl flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="min-w-0 flex-1 mr-4">
            <p className="text-sm font-semibold text-gray-100">Object Detail</p>
            <p className="text-xs font-mono text-gray-500 mt-0.5 break-all">{obj.id}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={copy}
              title={copied ? 'Copied!' : 'Copy full object as JSON'}
              className="btn-ghost p-1.5 text-xs flex items-center gap-1"
            >
              {copied ? <span className="text-green-400 text-xs">✓ Copied</span> : <><Copy className="w-3.5 h-3.5" /><span className="text-xs">Copy</span></>}
            </button>
            <button
              onClick={() => onDelete(obj.id)}
              title="Delete this object permanently"
              className="btn-ghost p-1.5 text-red-500 flex items-center gap-1 text-xs"
            >
              <Trash2 className="w-3.5 h-3.5" /><span>Delete</span>
            </button>
            <button
              onClick={onClose}
              title="Close (Esc)"
              className="btn-ghost p-1.5 text-gray-400 hover:text-gray-100 text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border flex-shrink-0">
          {(['properties', 'raw', ...(obj.vector ? ['vector'] : [])] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t as typeof tab)}
              title={t === 'properties' ? 'View individual property values' : t === 'raw' ? 'View complete raw JSON object' : `View embedding vector (${obj.vector?.length} dimensions)`}
              className={cn(
                'px-5 py-2.5 text-xs font-medium capitalize border-b-2 -mb-px transition-colors',
                tab === t ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-100'
              )}
            >
              {t === 'vector' ? `Vector (${obj.vector?.length}d)` : t === 'raw' ? 'Raw JSON' : 'Properties'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'properties' && (
            <div className="space-y-3">
              {Object.entries(obj.properties).map(([key, val]) => (
                <div key={key} className="bg-surface-200 rounded-lg px-4 py-3">
                  <p className="text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">{key}</p>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap break-words leading-relaxed">
                    {typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? '—')}
                  </p>
                </div>
              ))}
              {Object.keys(obj.properties).length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">No properties</p>
              )}
            </div>
          )}

          {tab === 'raw' && (
            <pre className="text-xs font-mono text-gray-300 leading-relaxed whitespace-pre-wrap break-words bg-surface-200 rounded-lg p-4">
              {JSON.stringify(obj, null, 2)}
            </pre>
          )}

          {tab === 'vector' && obj.vector && (
            <div className="space-y-4">
              <VectorPreview vector={obj.vector} />
              <div className="bg-surface-200 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-2">First 16 dimensions</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {obj.vector.slice(0, 16).map((v, i) => (
                    <div key={i} className="flex items-center justify-between text-xs font-mono bg-surface-300 rounded px-2 py-1">
                      <span className="text-gray-500">[{i}]</span>
                      <span className={v >= 0 ? 'text-accent' : 'text-red-400'}>{v.toFixed(6)}</span>
                    </div>
                  ))}
                </div>
                {obj.vector.length > 16 && (
                  <p className="text-xs text-gray-600 mt-2 text-center">… and {obj.vector.length - 16} more dimensions</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function CollectionDetailPage() {
  const { name = '' } = useParams()
  const navigate = useNavigate()
  const { data: collection, isLoading: colLoading } = useCollection(name)
  const { data: count } = useObjectCount(name)

  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25
  const { data: objectsData, isLoading: objLoading, refetch } = useObjects(name, PAGE_SIZE, page * PAGE_SIZE)
  const createObject = useCreateObject()
  const deleteObject = useDeleteObject()

  const [selectedObj, setSelectedObj] = useState<DBObject | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newProps, setNewProps] = useState('{\n  "content": ""\n}')
  const [activeTab, setActiveTab] = useState<'schema' | 'objects'>('objects')

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const props = JSON.parse(newProps)
      await createObject.mutateAsync({ className: name, properties: props })
      setShowCreate(false)
      setNewProps('{\n  "content": ""\n}')
      refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Invalid JSON')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this object?')) return
    await deleteObject.mutateAsync({ className: name, id })
    setSelectedObj(null)
    refetch()
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/collections')} title="Back to Collections" className="btn-ghost p-1.5">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-lg font-semibold font-mono text-gray-100">{name}</h2>
          <p className="text-xs text-gray-500">{formatNumber(count ?? 0)} objects</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['objects', 'schema'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={cn('px-4 py-2 text-sm capitalize transition-colors border-b-2 -mb-px', activeTab === t
              ? 'border-accent text-accent font-medium'
              : 'border-transparent text-gray-400 hover:text-gray-100')}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Schema tab */}
      {activeTab === 'schema' && !colLoading && collection && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Property</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Type</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium cursor-help" title="Property is included in BM25 keyword and hybrid search">Searchable</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium cursor-help" title="Property can be used in where-clause filters">Filterable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {collection.properties?.map((p) => (
                <tr key={p.name} className="hover:bg-surface-200">
                  <td className="px-4 py-2 font-mono text-gray-200">{p.name}</td>
                  <td className="px-4 py-2">
                    <span className="badge bg-surface-300 text-gray-300">{p.dataType}</span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{p.searchable ? '✓' : '—'}</td>
                  <td className="px-4 py-2 text-gray-500">{p.filterable ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-border bg-surface-200 text-xs text-gray-500">
            Distance: <span className="text-gray-300">{collection.distance ?? 'cosine'}</span>
            {collection.vectorDimensions && <>{' · '}Dimensions: <span className="text-gray-300">{collection.vectorDimensions}</span></>}
            {collection.vectorizer && <>{' · '}Vectorizer: <span className="text-gray-300">{collection.vectorizer}</span></>}
          </div>
        </div>
      )}

      {/* Objects tab */}
      {activeTab === 'objects' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">Page {page + 1} of {totalPages || 1}</p>
            <div className="flex gap-2">
              <button onClick={() => refetch()} title="Reload objects from Weaviate" className="btn-ghost text-xs"><RefreshCw className="w-3.5 h-3.5" /></button>
              <button onClick={() => setShowCreate(true)} title="Add a new object to this collection" className="btn-primary text-xs">
                <Plus className="w-3.5 h-3.5" /> New Object
              </button>
            </div>
          </div>

          <div className="card overflow-hidden">
            {objLoading && <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>}
            {!objLoading && !objectsData?.objects.length && (
              <p className="py-8 text-center text-sm text-gray-500">No objects in this collection</p>
            )}
            {!objLoading && (objectsData?.objects?.length ?? 0) > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">ID</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Properties</th>
                    <th className="px-4 py-3 text-xs text-gray-500 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {objectsData?.objects?.map((obj) => (
                    <tr key={obj.id} className="hover:bg-surface-200 group">
                      <td className="px-4 py-2 font-mono text-xs text-gray-500 w-40" title={obj.id}>{truncate(obj.id, 12)}…</td>
                      <td className="px-4 py-2 text-gray-300 text-xs">
                        {truncate(JSON.stringify(obj.properties), 80)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setSelectedObj(obj as any)} title="View full object details" className="btn-ghost p-1">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(obj.id)} title="Delete this object permanently" className="btn-ghost p-1 text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} title="Go to previous page" className="btn-secondary text-xs disabled:opacity-30">
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} title="Go to next page" className="btn-secondary text-xs disabled:opacity-30">
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}

      {/* Object detail modal */}
      {selectedObj && (
        <ObjectDetailModal obj={selectedObj as any} onClose={() => setSelectedObj(null)} onDelete={handleDelete} />
      )}

      {/* Create object modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-2xl p-6 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-100">New Object</h3>
              <p className="text-xs text-gray-500 mt-0.5">Enter properties as a JSON object. The vector will be generated or left empty depending on the collection's vectorizer.</p>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1" title="A valid JSON object mapping property names to values">
                  Properties (JSON)
                </label>
                <textarea
                  className="input font-mono text-sm h-56 resize-y"
                  value={newProps}
                  onChange={(e) => setNewProps(e.target.value)}
                  spellCheck={false}
                  title="Enter property values as a JSON object"
                  placeholder={'{\n  "title": "My document",\n  "content": "Text content here"\n}'}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreate(false)} title="Discard and close" className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createObject.isPending} title="Save object to Weaviate" className="btn-primary">
                  {createObject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
