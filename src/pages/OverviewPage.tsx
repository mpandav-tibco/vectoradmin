import { useNavigate } from 'react-router-dom'
import { Database, Layers, CheckCircle, XCircle, Loader2, ArrowRight } from 'lucide-react'
import { useCollections, useObjectCount } from '@/hooks/useCollections'
import { useHealth } from '@/hooks/useHealth'
import { useConnectionStore } from '@/store/connectionStore'
import { formatNumber } from '@/lib/utils/format'

function CollectionStat({ name }: { name: string }) {
  const { data } = useObjectCount(name)
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-300 font-mono">{name}</span>
      <span className="text-xs text-gray-500">{data !== undefined ? formatNumber(data) + ' objects' : '…'}</span>
    </div>
  )
}

export function OverviewPage() {
  const navigate = useNavigate()
  const { config, version } = useConnectionStore()
  const { data: health, isLoading: healthLoading } = useHealth()
  const { data: collections, isLoading: colLoading } = useCollections()

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-100">Overview</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {config?.scheme}://{config?.host}:{config?.port}
        </p>
      </div>

      {/* Health cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            {healthLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
            ) : health?.ready ? (
              <CheckCircle className="w-4 h-4 text-green-400" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400" />
            )}
            <span className="text-xs font-medium text-gray-400">Status</span>
          </div>
          <p className="text-sm text-gray-100 font-medium">
            {health?.ready ? 'Ready' : 'Unavailable'}
          </p>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-4 h-4 text-accent" />
            <span className="text-xs font-medium text-gray-400">Version</span>
          </div>
          <p className="text-sm text-gray-100 font-mono">{version ?? '…'}</p>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-accent" />
            <span className="text-xs font-medium text-gray-400">Collections</span>
          </div>
          <p className="text-2xl font-bold text-gray-100">
            {colLoading ? '…' : collections?.length ?? 0}
          </p>
        </div>
      </div>

      {/* Collections list */}
      <div className="card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-gray-200">Collections</h3>
          <button onClick={() => navigate('/collections')} className="btn-ghost text-xs gap-1">
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <div className="px-4 divide-y divide-border">
          {colLoading && (
            <div className="py-6 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
            </div>
          )}
          {!colLoading && !collections?.length && (
            <p className="py-6 text-center text-sm text-gray-500">No collections yet</p>
          )}
          {collections?.slice(0, 8).map((c) => (
            <button
              key={c.class}
              onClick={() => navigate(`/collections/${c.class}`)}
              className="w-full text-left hover:bg-surface-200 -mx-4 px-4 transition-colors"
            >
              <CollectionStat name={c.class} />
            </button>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Browse Collections', desc: 'View schema & objects', to: '/collections' },
          { label: 'Search', desc: 'Semantic, BM25, Hybrid', to: '/search' },
          { label: 'RAG Playground', desc: 'Test your pipelines', to: '/rag' },
        ].map((a) => (
          <button
            key={a.to}
            onClick={() => navigate(a.to)}
            className="card p-4 text-left hover:bg-surface-200 transition-colors"
          >
            <p className="text-sm font-medium text-gray-200">{a.label}</p>
            <p className="text-xs text-gray-500 mt-0.5">{a.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
