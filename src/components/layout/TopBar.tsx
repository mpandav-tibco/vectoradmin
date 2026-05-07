import { useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Sun, Moon } from 'lucide-react'
import { useConnectionStore } from '@/store/connectionStore'
import { useAppStore } from '@/store/appStore'
import { buildBaseURL } from '@/lib/weaviate/client'

const DB_LABELS: Record<string, string> = {
  weaviate: 'Weaviate',
  qdrant: 'Qdrant',
  chroma: 'Chroma',
  pinecone: 'Pinecone',
  pgvector: 'pgvector',
  activespaces: 'ActiveSpaces',
}

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
  const { theme, setTheme } = useAppStore()

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
          <>
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent-muted text-accent font-medium">
              {DB_LABELS[config.dbType] ?? config.dbType}
            </span>
            <span
              className="text-xs text-gray-500 font-mono"
              title={`${buildBaseURL(config)} → ${config.scheme}://${config.host}:${config.port}`}
            >
              {config.host}:{config.port}
            </span>
          </>
        )}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="btn-ghost p-1.5 rounded"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <button onClick={handleDisconnect} className="btn-ghost p-1.5 rounded" title="Disconnect">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
