import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, RefreshCw, Eye, ChevronLeft, ChevronRight, Loader2, Copy } from 'lucide-react'
import { useCollection, useObjectCount } from '@/hooks/useCollections'
import { useObjects, useCreateObject, useDeleteObject } from '@/hooks/useObjects'
import { formatNumber, formatDate, truncate } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'
import type { WeaviateObject } from '@/types/domain'

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

function ObjectDetailPanel({ obj, onClose, onDelete }: {
  obj: { id: string; class: string; properties: Record<string, unknown>; vector?: number[] }
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-end z-50">
      <div className="w-full max-w-xl h-full bg-surface-100 border-l border-border flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <p className="text-sm font-medium text-gray-100">Object Detail</p>
            <p className="text-xs font-mono text-gray-500">{obj.id}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={copy} className="btn-ghost text-xs">{copied ? '✓' : <Copy className="w-3.5 h-3.5" />}</button>
            <button onClick={() => onDelete(obj.id)} className="btn-ghost text-red-500 text-xs"><Trash2 className="w-3.5 h-3.5" /></button>
            <button onClick={onClose} className="btn-ghost text-xs">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Properties</p>
            <pre className="text-xs font-mono bg-surface-200 rounded-lg p-3 overflow-x-auto text-gray-300 leading-relaxed">
              {JSON.stringify(obj.properties, null, 2)}
            </pre>
          </div>
          {obj.vector && (
            <div>
              <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">
                Vector <span className="normal-case">({obj.vector.length} dims)</span>
              </p>
              <VectorPreview vector={obj.vector} />
              <p className="text-xs font-mono text-gray-600 mt-1">
                [{obj.vector.slice(0, 4).map((v) => v.toFixed(4)).join(', ')}, …]
              </p>
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

  const [selectedObj, setSelectedObj] = useState<WeaviateObject | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newProps, setNewProps] = useState('{\n  "content": ""\n}')
  const [activeTab, setActiveTab] = useState<'schema' | 'objects'>('objects')

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const props = JSON.parse(newProps)
      await createObject.mutateAsync({ class: name, properties: props })
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
        <button onClick={() => navigate('/collections')} className="btn-ghost p-1.5">
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
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Searchable</th>
                <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Filterable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {collection.properties?.map((p) => (
                <tr key={p.name} className="hover:bg-surface-200">
                  <td className="px-4 py-2 font-mono text-gray-200">{p.name}</td>
                  <td className="px-4 py-2">
                    <span className="badge bg-surface-300 text-gray-300">{p.dataType.join(', ')}</span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{p.indexSearchable ? '✓' : '—'}</td>
                  <td className="px-4 py-2 text-gray-500">{p.indexFilterable ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-border bg-surface-200 text-xs text-gray-500">
            Distance: <span className="text-gray-300">{collection.vectorIndexConfig?.distance ?? 'cosine'}</span>
            {' · '}Vectorizer: <span className="text-gray-300">{collection.vectorizer ?? 'none'}</span>
          </div>
        </div>
      )}

      {/* Objects tab */}
      {activeTab === 'objects' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">Page {page + 1} of {totalPages || 1}</p>
            <div className="flex gap-2">
              <button onClick={() => refetch()} className="btn-ghost text-xs"><RefreshCw className="w-3.5 h-3.5" /></button>
              <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">
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
                      <td className="px-4 py-2 font-mono text-xs text-gray-500 w-40">{truncate(obj.id, 12)}…</td>
                      <td className="px-4 py-2 text-gray-300 text-xs">
                        {truncate(JSON.stringify(obj.properties), 80)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setSelectedObj(obj as any)} className="btn-ghost p-1">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(obj.id)} className="btn-ghost p-1 text-red-500">
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
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="btn-secondary text-xs disabled:opacity-30">
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="btn-secondary text-xs disabled:opacity-30">
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}

      {/* Object detail panel */}
      {selectedObj && (
        <ObjectDetailPanel obj={selectedObj as any} onClose={() => setSelectedObj(null)} onDelete={handleDelete} />
      )}

      {/* Create object modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg p-6 space-y-4">
            <h3 className="font-semibold text-gray-100">New Object</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Properties (JSON)</label>
                <textarea
                  className="input font-mono text-xs h-40 resize-none"
                  value={newProps}
                  onChange={(e) => setNewProps(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createObject.isPending} className="btn-primary">
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
