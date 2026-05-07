import { useLocation, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useConnectionStore } from '@/store/connectionStore'
import { buildBaseURL } from '@/lib/weaviate/client'

const CRUMBS: Record<string, string> = {
  '/': 'Overview',
  '/collections': 'Collections',
  '/search': 'Search',
  '/ingest': 'Ingest Documents',
  '/rag': 'RAG Playground',
}

export function TopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { config, disconnect } = useConnectionStore()

  const parts = location.pathname.split('/').filter(Boolean)
  const label = CRUMBS[location.pathname] ?? parts.map((p) => decodeURIComponent(p)).join(' / ')

  const handleDisconnect = () => {
    disconnect()
    navigate('/connect')
  }

  return (
    <header className="h-12 flex items-center justify-between px-6 border-b border-border bg-surface-100 flex-shrink-0">
      <h1 className="text-sm font-medium text-gray-300">{label}</h1>
      <div className="flex items-center gap-3">
        {config && (
          <span
            className="text-xs text-gray-500 font-mono"
            title={`${buildBaseURL(config)} → ${config.scheme}://${config.host}:${config.port}`}
          >
            {config.scheme}://{config.host}:{config.port}
          </span>
        )}
        <button onClick={handleDisconnect} className="btn-ghost p-1.5 rounded" title="Disconnect">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
