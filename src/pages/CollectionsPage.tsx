import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, ChevronRight, Loader2, Database } from 'lucide-react'
import { useCollections, useObjectCount, useCreateCollection, useDeleteCollection } from '@/hooks/useCollections'
import { formatNumber } from '@/lib/utils/format'
import type { WeaviateCollection, WeaviateProperty } from '@/types/domain'

function ObjectCount({ name }: { name: string }) {
  const { data } = useObjectCount(name)
  return <span>{data !== undefined ? formatNumber(data) : '…'}</span>
}

function CreateCollectionModal({ onClose }: { onClose: () => void }) {
  const create = useCreateCollection()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [distance, setDistance] = useState<'cosine' | 'dot' | 'euclidean'>('cosine')
  const [props, setProps] = useState([{ name: 'content', dataType: 'text' }])

  const addProp = () => setProps((p) => [...p, { name: '', dataType: 'text' }])
  const removeProp = (i: number) => setProps((p) => p.filter((_, j) => j !== i))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const collection: Partial<WeaviateCollection> = {
      class: name,
      description: desc || undefined,
      vectorIndexConfig: { distance },
      vectorizer: 'none',
      properties: props
        .filter((p) => p.name)
        .map((p): WeaviateProperty => ({
          name: p.name,
          dataType: [p.dataType],
          indexSearchable: true,
          indexFilterable: true,
        })),
    }
    await create.mutateAsync(collection)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-lg p-6 space-y-4">
        <h3 className="font-semibold text-gray-100">Create Collection</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Class Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Documents" required pattern="[A-Z][a-zA-Z0-9_]*"
              title="Must start with uppercase letter" />
            <p className="text-xs text-gray-600 mt-1">Must start with an uppercase letter</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Distance Metric</label>
            <select className="input" value={distance} onChange={(e) => setDistance(e.target.value as typeof distance)}>
              <option value="cosine">Cosine</option>
              <option value="dot">Dot Product</option>
              <option value="euclidean">Euclidean</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400">Properties</label>
              <button type="button" onClick={addProp} className="btn-ghost text-xs">+ Add</button>
            </div>
            <div className="space-y-2">
              {props.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input flex-1" placeholder="name" value={p.name}
                    onChange={(e) => setProps((ps) => ps.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <select className="input w-32" value={p.dataType}
                    onChange={(e) => setProps((ps) => ps.map((x, j) => j === i ? { ...x, dataType: e.target.value } : x))}>
                    <option>text</option>
                    <option>int</option>
                    <option>number</option>
                    <option>boolean</option>
                    <option>date</option>
                    <option>uuid</option>
                    <option>text[]</option>
                  </select>
                  <button type="button" onClick={() => removeProp(i)} className="btn-ghost p-2 text-red-500">×</button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={create.isPending} className="btn-primary">
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

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
        <button onClick={() => setShowCreate(true)} className="btn-primary">
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
          <div key={col.class} className="card flex items-center justify-between p-4 hover:bg-surface-200 transition-colors group">
            <button onClick={() => navigate(`/collections/${col.class}`)} className="flex items-center gap-3 flex-1 min-w-0">
              <Database className="w-4 h-4 text-accent flex-shrink-0" />
              <div className="text-left min-w-0">
                <p className="font-medium text-gray-100 font-mono">{col.class}</p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{col.description || `${col.properties?.length ?? 0} properties · ${col.vectorIndexConfig?.distance ?? 'cosine'}`}</p>
              </div>
              <div className="ml-auto mr-4 text-right flex-shrink-0">
                <p className="text-xs text-gray-500"><ObjectCount name={col.class} /> objects</p>
                <p className="text-xs text-gray-600">{col.properties?.length ?? 0} props</p>
              </div>
            </button>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => navigate(`/collections/${col.class}`)} className="btn-ghost p-1.5">
                <ChevronRight className="w-4 h-4" />
              </button>
              <button onClick={() => setConfirmDelete(col.class)} className="btn-ghost p-1.5 text-red-500 hover:text-red-400">
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
