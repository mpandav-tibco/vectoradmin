import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileText, X, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { useCollections } from '@/hooks/useCollections'
import { useBatchUpsert } from '@/hooks/useObjects'
import { useAppStore } from '@/store/appStore'
import { chunkText, extractTextFromFile } from '@/lib/chunker'
import { embed } from '@/lib/embedding/client'
import { generateId, formatBytes, formatDuration } from '@/lib/utils/format'
import type { ChunkConfig, EmbeddingConfig } from '@/types/domain'
import { cn } from '@/lib/utils/cn'

type Step = 'idle' | 'extracting' | 'chunking' | 'embedding' | 'upserting' | 'done' | 'error'

interface Progress { step: Step; current: number; total: number; error?: string }

function EmbeddingConfigPanel({ value, onChange }: { value: EmbeddingConfig; onChange: (v: EmbeddingConfig) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Provider</label>
        <select className="input text-sm" value={value.provider}
          onChange={(e) => onChange({ ...value, provider: e.target.value as EmbeddingConfig['provider'] })}>
          <option value="ollama">Ollama (local)</option>
          <option value="openai">OpenAI</option>
          <option value="cohere">Cohere</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Model</label>
        <input className="input text-sm" value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })}
          placeholder="nomic-embed-text" />
      </div>
      {value.provider !== 'ollama' && (
        <div className="col-span-2">
          <label className="block text-xs text-gray-400 mb-1">API Key</label>
          <input className="input text-sm font-mono" type="password" value={value.apiKey ?? ''}
            onChange={(e) => onChange({ ...value, apiKey: e.target.value })} />
        </div>
      )}
      {(value.provider === 'ollama' || value.provider === 'custom') && (
        <div className="col-span-2">
          <label className="block text-xs text-gray-400 mb-1">Base URL</label>
          <input className="input text-sm font-mono" value={value.baseURL ?? ''}
            onChange={(e) => onChange({ ...value, baseURL: e.target.value })} placeholder="http://localhost:11434" />
        </div>
      )}
    </div>
  )
}

export function IngestPage() {
  const { data: collections } = useCollections()
  const batchUpsert = useBatchUpsert()
  const { embeddingConfig, setEmbeddingConfig } = useAppStore()

  const [className, setClassName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [pastedText, setPastedText] = useState('')
  const [showEmbed, setShowEmbed] = useState(false)
  const [progress, setProgress] = useState<Progress>({ step: 'idle', current: 0, total: 0 })
  const [result, setResult] = useState<{ chunks: number; success: number; duration: number; errors: string[] } | null>(null)

  const [chunkConfig, setChunkConfig] = useState<ChunkConfig>({
    strategy: 'paragraph',
    size: 512,
    overlap: 64,
  })

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((f) => [...f, ...accepted])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/*': ['.txt', '.md'], 'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/json': ['.json'] },
    multiple: true,
  })

  const handleIngest = async () => {
    if (!className || (files.length === 0 && !pastedText.trim())) return
    setResult(null)
    const t0 = Date.now()

    try {
      // Extract text
      setProgress({ step: 'extracting', current: 0, total: files.length + (pastedText ? 1 : 0) })
      const texts: string[] = []
      for (const file of files) {
        texts.push(await extractTextFromFile(file))
        setProgress((p) => ({ ...p, current: p.current + 1 }))
      }
      if (pastedText.trim()) texts.push(pastedText)

      // Chunk
      setProgress({ step: 'chunking', current: 0, total: texts.length })
      const allChunks: string[] = []
      for (const text of texts) {
        const chunks = chunkText(text, chunkConfig)
        allChunks.push(...chunks.map((c) => c.text))
        setProgress((p) => ({ ...p, current: p.current + 1 }))
      }

      // Embed in batches of 50
      setProgress({ step: 'embedding', current: 0, total: allChunks.length })
      const BATCH = 50
      const vectors: number[][] = []
      for (let i = 0; i < allChunks.length; i += BATCH) {
        const batch = allChunks.slice(i, i + BATCH)
        const batchVectors = await embed(batch, embeddingConfig)
        vectors.push(...batchVectors)
        setProgress((p) => ({ ...p, current: Math.min(i + BATCH, allChunks.length) }))
      }

      // Upsert
      setProgress({ step: 'upserting', current: 0, total: allChunks.length })
      const objects = allChunks.map((text, i) => ({
        id: generateId(),
        properties: { content: text },
        vector: vectors[i],
      }))

      const res = await batchUpsert.mutateAsync({ className, objects })
      setProgress({ step: 'done', current: allChunks.length, total: allChunks.length })
      setResult({ chunks: allChunks.length, success: res.success, duration: Date.now() - t0, errors: res.errors })
    } catch (err) {
      setProgress({ step: 'error', current: 0, total: 0, error: err instanceof Error ? err.message : 'Failed' })
    }
  }

  const steps: Array<{ key: Step; label: string }> = [
    { key: 'extracting', label: 'Extracting text' },
    { key: 'chunking', label: 'Chunking' },
    { key: 'embedding', label: 'Generating embeddings' },
    { key: 'upserting', label: 'Upserting to database' },
  ]

  const stepOrder = ['idle', 'extracting', 'chunking', 'embedding', 'upserting', 'done', 'error']
  const currentStepIdx = stepOrder.indexOf(progress.step)
  const isRunning = ['extracting', 'chunking', 'embedding', 'upserting'].includes(progress.step)

  return (
    <div className="space-y-5 max-w-2xl">
      <h2 className="text-lg font-semibold text-gray-100">Ingest Documents</h2>

      {/* Collection */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Target Collection</label>
        <select className="input" value={className} onChange={(e) => setClassName(e.target.value)}>
          <option value="">Select collection…</option>
          {collections?.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      </div>

      {/* File drop */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Files</label>
        <div {...getRootProps()} className={cn(
          'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-accent bg-accent-muted/20' : 'border-border hover:border-gray-500'
        )}>
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-400">{isDragActive ? 'Drop files here' : 'Drop files or click to browse'}</p>
          <p className="text-xs text-gray-600 mt-1">TXT, MD, PDF, DOCX, JSON</p>
        </div>
        {files.length > 0 && (
          <div className="mt-2 space-y-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center justify-between bg-surface-200 rounded px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-xs text-gray-300">{f.name}</span>
                  <span className="text-xs text-gray-600">{formatBytes(f.size)}</span>
                </div>
                <button onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} className="text-gray-600 hover:text-gray-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Paste text */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Or paste text directly</label>
        <textarea className="input h-28 resize-none text-sm" placeholder="Paste document text here…"
          value={pastedText} onChange={(e) => setPastedText(e.target.value)} />
      </div>

      {/* Chunking config */}
      <div className="card p-4 space-y-3">
        <p className="text-xs font-medium text-gray-400">Chunking Strategy</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Strategy</label>
            <select className="input text-sm" value={chunkConfig.strategy}
              onChange={(e) => setChunkConfig((c) => ({ ...c, strategy: e.target.value as ChunkConfig['strategy'] }))}>
              <option value="paragraph">Paragraph</option>
              <option value="sentence">Sentence</option>
              <option value="fixed">Fixed size</option>
              <option value="heading">By heading</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Size</label>
              <input type="number" className="input text-sm text-center" value={chunkConfig.size}
                onChange={(e) => setChunkConfig((c) => ({ ...c, size: Number(e.target.value) }))} min={64} max={4096} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Overlap</label>
              <input type="number" className="input text-sm text-center" value={chunkConfig.overlap}
                onChange={(e) => setChunkConfig((c) => ({ ...c, overlap: Number(e.target.value) }))} min={0} max={512} />
            </div>
          </div>
        </div>
      </div>

      {/* Embedding config */}
      <div className="card p-4 space-y-3">
        <button onClick={() => setShowEmbed((v) => !v)} className="flex items-center justify-between w-full">
          <p className="text-xs font-medium text-gray-400">Embedding Config</p>
          {showEmbed ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
        </button>
        {showEmbed && <EmbeddingConfigPanel value={embeddingConfig} onChange={setEmbeddingConfig} />}
        {!showEmbed && <p className="text-xs text-gray-600">{embeddingConfig.provider} · {embeddingConfig.model}</p>}
      </div>

      {/* Run button */}
      <button
        onClick={handleIngest}
        disabled={isRunning || !className || (files.length === 0 && !pastedText.trim())}
        className="btn-primary w-full justify-center py-2.5"
      >
        {isRunning ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</> : 'Start Ingestion'}
      </button>

      {/* Progress */}
      {progress.step !== 'idle' && (
        <div className="card p-4 space-y-3">
          {steps.map(({ key, label }, i) => {
            const stepIdx = stepOrder.indexOf(key)
            const done = currentStepIdx > stepIdx
            const active = progress.step === key
            const pending = currentStepIdx < stepIdx
            return (
              <div key={key} className="flex items-center gap-3">
                <div className={cn('w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs',
                  done ? 'bg-green-500/20 text-green-400' : active ? 'bg-accent/20 text-accent' : 'bg-surface-300 text-gray-600')}>
                  {done ? '✓' : i + 1}
                </div>
                <div className="flex-1">
                  <p className={cn('text-sm', done ? 'text-gray-500' : active ? 'text-gray-100' : 'text-gray-600')}>{label}</p>
                  {active && progress.total > 0 && (
                    <div className="mt-1 h-1 bg-surface-300 rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                    </div>
                  )}
                </div>
                {active && <span className="text-xs text-gray-500">{progress.current}/{progress.total}</span>}
              </div>
            )
          })}

          {progress.step === 'error' && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4" /> {progress.error}
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm font-medium">Ingestion complete</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-2">
            {[['Chunks created', result.chunks], ['Objects upserted', result.success], ['Duration', formatDuration(result.duration)]].map(
              ([label, value]) => (
                <div key={label as string} className="bg-surface-200 rounded p-2 text-center">
                  <p className="text-lg font-bold text-gray-100">{value}</p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              )
            )}
          </div>
          {result.errors.length > 0 && (
            <div className="text-xs text-red-400">{result.errors.length} errors: {result.errors[0]}</div>
          )}
        </div>
      )}
    </div>
  )
}
