import { useState, useCallback, useEffect } from 'react'
import { ArrowRightLeft, Loader2, AlertCircle, CheckCircle, RefreshCw, ChevronDown, ChevronUp, GitCompare } from 'lucide-react'
import { useCollections, useCollection } from '@/hooks/useCollections'
import { useConnectionStore } from '@/store/connectionStore'
import { getAdapter } from '@/lib/adapters'
import { formatNumber } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'
import type { ConnectionConfig } from '@/types/domain'
import type { DBProperty } from '@/lib/adapters'

const DB_LABELS: Record<string, string> = {
  weaviate: 'Weaviate', qdrant: 'Qdrant', chroma: 'Chroma',
  pinecone: 'Pinecone', pgvector: 'pgvector', activespaces: 'ActiveSpaces',
}

interface TransferLog { message: string; type: 'info' | 'ok' | 'error' }

export function TransferPage() {
  const { config, savedConnections } = useConnectionStore()
  const { data: collections } = useCollections()

  const [sourceCollection, setSourceCollection] = useState('')
  const [targetMode, setTargetMode] = useState<'same' | 'saved'>('same')
  const [savedIdx, setSavedIdx] = useState(0)
  const [targetCollection, setTargetCollection] = useState('')
  const [batchSize, setBatchSize] = useState(100)
  const [includeVectors, setIncludeVectors] = useState(true)
  const [showOptions, setShowOptions] = useState(false)

  const [running, setRunning] = useState(false)
  const [transferred, setTransferred] = useState(0)
  const [total, setTotal] = useState(0)
  const [log, setLog] = useState<TransferLog[]>([])
  const [done, setDone] = useState(false)

  const [targetHealth, setTargetHealth] = useState<'unchecked' | 'ok' | 'error'>('unchecked')
  const [targetHealthMsg, setTargetHealthMsg] = useState('')
  const [testingTarget, setTestingTarget] = useState(false)

  const targetConfig: ConnectionConfig =
    targetMode === 'same' ? config! : savedConnections[savedIdx] ?? config!

  // Schema diff
  const { data: sourceCollectionData } = useCollection(sourceCollection)
  const [targetProps, setTargetProps] = useState<DBProperty[] | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)

  useEffect(() => {
    if (!targetCollection) { setTargetProps(null); return }
    setDiffLoading(true)
    getAdapter(targetConfig).getCollection(targetCollection)
      .then((col) => setTargetProps(col.properties ?? []))
      .catch(() => setTargetProps([]))
      .finally(() => setDiffLoading(false))
  }, [targetCollection, targetConfig.host, targetConfig.port, targetConfig.dbType])

  const testTarget = async () => {
    setTestingTarget(true)
    setTargetHealth('unchecked')
    try {
      const h = await getAdapter(targetConfig).checkHealth()
      if (h.ready) {
        setTargetHealth('ok')
        setTargetHealthMsg(h.version ?? 'connected')
      } else {
        setTargetHealth('error')
        setTargetHealthMsg(h.error ?? 'not ready')
      }
    } catch (e) {
      setTargetHealth('error')
      setTargetHealthMsg(e instanceof Error ? e.message : 'connection failed')
    } finally {
      setTestingTarget(false)
    }
  }

  const addLog = useCallback((message: string, type: TransferLog['type'] = 'info') => {
    setLog((l) => [...l, { message, type }])
  }, [])

  const handleTransfer = async () => {
    if (!sourceCollection || !targetCollection || !config) return
    setRunning(true)
    setDone(false)
    setLog([])
    setTransferred(0)
    setTotal(0)

    try {
      const src = getAdapter(config)
      const tgt = getAdapter(targetConfig)

      // Fetch source schema and count in parallel
      const [srcCol, count] = await Promise.all([
        src.getCollection(sourceCollection),
        src.getObjectCount(sourceCollection),
      ])
      setTotal(count)
      addLog(`Source: ${formatNumber(count)} objects in "${sourceCollection}"${srcCol.vectorDimensions ? ` · ${srcCol.vectorDimensions}d` : ''}`)
      addLog(`Target: "${targetCollection}" on ${DB_LABELS[targetConfig.dbType] ?? targetConfig.dbType} ${targetConfig.host}:${targetConfig.port}`)

      // Detect actual vector dimensions from a sample when schema doesn't report them
      // (e.g. Weaviate with vectorizer:none doesn't embed dimensions in the schema)
      let dims = srcCol.vectorDimensions && srcCol.vectorDimensions > 0 ? srcCol.vectorDimensions : undefined
      if (!dims && includeVectors) {
        addLog('Vector dimensions not in schema — sampling first objects to detect…')
        const sample = await src.listObjects(sourceCollection, 20, 0)
        const withVec = sample.objects.find((o) => o.vector && o.vector.length > 0)
        if (withVec?.vector) {
          dims = withVec.vector.length
          addLog(`Detected ${dims}d vectors from sample`)
        } else {
          addLog('No vectors found in sample — objects will be transferred without vectors', 'error')
        }
      }

      // Ensure target collection exists — create it from source schema if missing
      try {
        await tgt.getCollection(targetCollection)
        addLog(`Target collection "${targetCollection}" already exists`)
      } catch {
        const dist = srcCol.distance ?? 'cosine'
        addLog(
          dims
            ? `Target collection "${targetCollection}" not found — creating (${dims}d, ${dist})…`
            : `Target collection "${targetCollection}" not found — creating (no vectors, ${dist})…`
        )
        await tgt.createCollection({
          name: targetCollection,
          vectorDimensions: dims,
          distance: dist as 'cosine' | 'dot' | 'euclidean' | 'hamming',
          properties: srcCol.properties?.map((p) => ({ name: p.name, dataType: p.dataType })),
        })
        addLog(`✓ Collection "${targetCollection}" created`, 'ok')
      }

      let offset = 0
      let totalTransferred = 0
      let totalSkipped = 0

      while (true) {
        addLog(`Fetching offset ${offset}…`)
        const { objects } = await src.listObjects(sourceCollection, batchSize, offset)
        if (objects.length === 0) break

        // Skip objects with missing/empty vectors when target requires them
        const withVectors = includeVectors
          ? objects.filter((o) => o.vector && o.vector.length > 0)
          : objects
        const skipped = objects.length - withVectors.length
        if (skipped > 0) {
          totalSkipped += skipped
          addLog(`Skipped ${skipped} object${skipped === 1 ? '' : 's'} with no vector in this batch`, 'error')
        }

        if (withVectors.length === 0) {
          offset += objects.length
          if (objects.length < batchSize) break
          continue
        }

        const batch = withVectors.map((o) => ({
          id: o.id,
          properties: o.properties,
          vector: includeVectors ? o.vector : undefined,
        }))

        const result = await tgt.batchInsert(targetCollection, batch)
        totalTransferred += result.success
        setTransferred(totalTransferred)

        if (result.errors.length > 0) {
          addLog(`Batch errors: ${result.errors[0]}`, 'error')
        } else {
          addLog(`✓ ${totalTransferred}/${count} objects transferred`, 'ok')
        }

        offset += objects.length
        if (objects.length < batchSize) break
      }

      if (totalSkipped > 0) {
        addLog(`${totalSkipped} object${totalSkipped === 1 ? '' : 's'} skipped (no stored vector) — transfer properties-only by disabling "Include vectors"`, 'error')
      }

      addLog(`Transfer complete — ${formatNumber(totalTransferred)} objects copied.`, 'ok')
      setDone(true)
    } catch (e) {
      addLog(e instanceof Error ? e.message : 'Transfer failed', 'error')
    } finally {
      setRunning(false)
    }
  }

  const canTransfer =
    !!sourceCollection &&
    !!targetCollection &&
    !running &&
    (targetMode === 'same' || targetHealth === 'ok')

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-100">Transfer Collection</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Copy objects (and optionally vectors) from one collection to another — same connection or across saved connections.
        </p>
      </div>

      {/* Source */}
      <div className="card p-4 space-y-3">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Source</p>
        <div className="flex items-center gap-2 text-xs text-gray-500 font-mono bg-surface-200 rounded px-3 py-2">
          {DB_LABELS[config?.dbType ?? ''] ?? 'DB'} · {config?.host}:{config?.port}
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Collection</label>
          <select className="input" value={sourceCollection} onChange={(e) => setSourceCollection(e.target.value)}>
            <option value="">Select collection…</option>
            {collections?.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}{c.objectCount ? ` (${formatNumber(c.objectCount)})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Arrow */}
      <div className="flex justify-center">
        <div className="w-8 h-8 rounded-full bg-surface-200 border border-border flex items-center justify-center">
          <ArrowRightLeft className="w-4 h-4 text-gray-500" />
        </div>
      </div>

      {/* Target */}
      <div className="card p-4 space-y-3">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Target</p>

        {/* Target connection selector */}
        <div className="flex rounded overflow-hidden border border-border text-xs font-medium">
          {(['same', 'saved'] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setTargetMode(m); setTargetHealth('unchecked') }}
              className={cn('flex-1 py-1.5 transition-colors', targetMode === m
                ? 'bg-accent text-white' : 'bg-surface-200 text-gray-400 hover:text-gray-100')}
            >
              {m === 'same' ? 'Same connection' : 'Saved connection'}
            </button>
          ))}
        </div>

        {targetMode === 'same' && (
          <p className="text-xs text-gray-600">Copying within {DB_LABELS[config?.dbType ?? ''] ?? 'DB'} · {config?.host}:{config?.port}</p>
        )}

        {targetMode === 'saved' && (
          <div className="space-y-2">
            {savedConnections.length === 0 ? (
              <p className="text-xs text-amber-400">No saved connections — connect to another instance first to save it.</p>
            ) : (
              <>
                <select
                  className="input text-sm"
                  value={savedIdx}
                  onChange={(e) => { setSavedIdx(Number(e.target.value)); setTargetHealth('unchecked') }}
                >
                  {savedConnections.map((sc, i) => (
                    <option key={i} value={i}>{sc.label}</option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={testTarget}
                    disabled={testingTarget}
                    className="btn-secondary text-xs gap-1"
                  >
                    {testingTarget ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Test connection
                  </button>
                  {targetHealth === 'ok' && (
                    <span className="text-xs text-green-400 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> {targetHealthMsg}
                    </span>
                  )}
                  {targetHealth === 'error' && (
                    <span className="text-xs text-red-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {targetHealthMsg}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-400 mb-1">Target collection name</label>
          <input
            className="input"
            value={targetCollection}
            onChange={(e) => setTargetCollection(e.target.value)}
            placeholder={sourceCollection ? `${sourceCollection}_copy` : 'collection-name'}
          />
          <p className="text-xs text-gray-600 mt-1">Auto-created from the source schema if it doesn't exist. For pgvector (PostgREST), the table must already exist.</p>
        </div>
      </div>

      {/* Schema diff */}
      {sourceCollection && targetCollection && (
        <div>
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            <GitCompare className="w-3.5 h-3.5" />
            Schema comparison
            {diffLoading && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
            <span className="text-gray-700">{showDiff ? '▲' : '▼'}</span>
          </button>
          {showDiff && (() => {
            const srcProps = sourceCollectionData?.properties ?? []
            const tgtProps = targetProps ?? []
            const srcMap = new Map(srcProps.map((p) => [p.name, p]))
            const tgtMap = new Map(tgtProps.map((p) => [p.name, p]))
            const allNames = [...new Set([...srcMap.keys(), ...tgtMap.keys()])].sort()
            return (
              <div className="mt-2 card overflow-hidden">
                {allNames.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-gray-500">
                    {diffLoading ? 'Loading…' : 'No schema properties available (schema-free DB or collection not found)'}
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-surface-200">
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Property</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Source type</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Target type</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {allNames.map((name) => {
                        const src = srcMap.get(name)
                        const tgt = tgtMap.get(name)
                        const status = src && tgt ? 'both' : src ? 'src-only' : 'tgt-only'
                        return (
                          <tr key={name} className={cn(
                            'hover:bg-surface-200',
                            status === 'src-only' && 'bg-amber-900/10',
                            status === 'tgt-only' && 'bg-blue-900/10',
                          )}>
                            <td className="px-4 py-2 font-mono text-gray-200">{name}</td>
                            <td className="px-4 py-2 text-gray-400">{src?.dataType ?? <span className="text-gray-600">—</span>}</td>
                            <td className="px-4 py-2 text-gray-400">{tgt?.dataType ?? <span className="text-gray-600">—</span>}</td>
                            <td className="px-4 py-2">
                              {status === 'both' && <span className="badge bg-surface-300 text-gray-400">Both</span>}
                              {status === 'src-only' && <span className="badge bg-amber-900/30 text-amber-400">Source only</span>}
                              {status === 'tgt-only' && <span className="badge bg-blue-900/30 text-blue-400">Target only</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Options */}
      <div>
        <button
          type="button"
          onClick={() => setShowOptions((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Options
          {showOptions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {showOptions && (
          <div className="mt-2 card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-300">Include vectors</p>
                <p className="text-xs text-gray-600">Copy raw embedding values alongside properties</p>
              </div>
              <button
                type="button"
                onClick={() => setIncludeVectors((v) => !v)}
                className={cn('w-10 h-5 rounded-full transition-colors relative', includeVectors ? 'bg-accent' : 'bg-surface-300')}
              >
                <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', includeVectors ? 'left-5' : 'left-0.5')} />
              </button>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Batch size <span className="text-gray-600">(objects per request)</span></label>
              <input
                type="number"
                className="input text-sm w-24 text-center"
                value={batchSize}
                min={10}
                max={500}
                onChange={(e) => setBatchSize(Number(e.target.value))}
              />
            </div>
          </div>
        )}
      </div>

      {/* Start button */}
      <button
        onClick={handleTransfer}
        disabled={!canTransfer}
        className="btn-primary w-full justify-center py-2.5"
      >
        {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Transferring…</> : 'Start Transfer'}
      </button>

      {/* Progress */}
      {(running || done) && total > 0 && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{formatNumber(transferred)} / {formatNumber(total)} objects</span>
            <span>{total > 0 ? Math.round((transferred / total) * 100) : 0}%</span>
          </div>
          <div className="h-1.5 bg-surface-300 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', done ? 'bg-green-500' : 'bg-accent')}
              style={{ width: `${total > 0 ? (transferred / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div className="card p-3 space-y-1 max-h-48 overflow-y-auto font-mono text-xs">
          {log.map((entry, i) => (
            <p key={i} className={cn(
              entry.type === 'ok' ? 'text-green-400' : entry.type === 'error' ? 'text-red-400' : 'text-gray-500'
            )}>
              {entry.message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
