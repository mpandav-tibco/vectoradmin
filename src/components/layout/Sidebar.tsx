import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Database, Search, Upload, MessageSquare, Layers, Circle, ArrowLeftRight, Unplug, Cable } from 'lucide-react'
import { useConnectionStore } from '@/store/connectionStore'
import { cn } from '@/lib/utils/cn'

const DB_LABELS: Record<string, string> = {
  weaviate: 'Weaviate',
  qdrant: 'Qdrant',
  chroma: 'Chroma',
  pinecone: 'Pinecone',
  pgvector: 'pgvector',
  activespaces: 'ActiveSpaces',
}

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/collections', icon: Database, label: 'Collections' },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/ingest', icon: Upload, label: 'Ingest' },
  { to: '/rag', icon: MessageSquare, label: 'RAG Playground' },
  { to: '/transfer', icon: ArrowLeftRight, label: 'Transfer' },
  { to: '/connections', icon: Cable, label: 'Connections' },
]

export function Sidebar() {
  const navigate = useNavigate()
  const { config, status, version, disconnect } = useConnectionStore()

  return (
    <aside className="w-56 flex-shrink-0 bg-surface-100 border-r border-border flex flex-col">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-accent" />
          <span className="font-semibold text-sm text-gray-100">Vector Admin</span>
        </div>
        <div className="mt-1 text-xs text-gray-500 font-mono truncate" title={config ? `${config.host}:${config.port}` : ''}>
          {config ? `${config.host}:${config.port}` : 'not connected'}
        </div>
      </div>

      {/* Connection status */}
      <div className="px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Circle
            className={cn('w-2 h-2 fill-current', {
              'text-green-400': status === 'connected',
              'text-red-400': status === 'error',
              'text-yellow-400': status === 'connecting',
              'text-gray-500': status === 'idle',
            })}
          />
          <span className="text-xs text-gray-400">
            {status === 'connected'
              ? `${DB_LABELS[config?.dbType ?? ''] ?? config?.dbType ?? 'DB'} ${version ?? ''}`.trim()
              : status}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-accent-muted text-accent font-medium'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-surface-200'
              )
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border space-y-2">
        <p className="text-xs text-gray-600">Vector Admin UI v0.1</p>
        <button
          type="button"
          onClick={() => { disconnect(); navigate('/connect') }}
          className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-300 transition-colors w-full"
        >
          <Unplug className="w-3 h-3" />
          Switch connection
        </button>
      </div>
    </aside>
  )
}
