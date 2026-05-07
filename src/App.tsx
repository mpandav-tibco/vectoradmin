import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useConnectionStore } from '@/store/connectionStore'
import { AppShell } from '@/components/layout/AppShell'
import { ConnectPage } from '@/pages/ConnectPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { CollectionsPage } from '@/pages/CollectionsPage'
import { CollectionDetailPage } from '@/pages/CollectionDetailPage'
import { SearchPage } from '@/pages/SearchPage'
import { IngestPage } from '@/pages/IngestPage'
import { RAGPage } from '@/pages/RAGPage'

function RequireConnection({ children }: { children: React.ReactNode }) {
  const config = useConnectionStore((s) => s.config)
  if (!config) return <Navigate to="/connect" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/connect" element={<ConnectPage />} />
        <Route
          path="/"
          element={
            <RequireConnection>
              <AppShell />
            </RequireConnection>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="collections/:name" element={<CollectionDetailPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="ingest" element={<IngestPage />} />
          <Route path="rag" element={<RAGPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
