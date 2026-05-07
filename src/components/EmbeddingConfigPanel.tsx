import type { EmbeddingConfig } from '@/types/domain'

interface Props {
  value: EmbeddingConfig
  onChange: (v: EmbeddingConfig) => void
  /** 'sm' (default) for Ingest, 'xs' for Search/RAG sidebar */
  size?: 'sm' | 'xs'
  /** Wrap in a bg-surface-200 border box (Search page style) */
  bordered?: boolean
}

export function EmbeddingConfigPanel({ value, onChange, size = 'sm', bordered = false }: Props) {
  const inp = `input ${size === 'sm' ? 'text-sm' : 'text-xs'}`
  const lbl = `block text-xs ${size === 'sm' ? 'text-gray-400' : 'text-gray-500'} mb-1`

  const inner = (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className={lbl}>Provider</label>
        <select
          className={inp}
          value={value.provider}
          onChange={(e) => onChange({ ...value, provider: e.target.value as EmbeddingConfig['provider'] })}
        >
          <option value="ollama">Ollama (local)</option>
          <option value="openai">OpenAI</option>
          <option value="cohere">Cohere</option>
          <option value="custom">Custom (OpenAI-compat)</option>
        </select>
      </div>
      <div>
        <label className={lbl}>Model</label>
        <input
          className={inp}
          value={value.model}
          onChange={(e) => onChange({ ...value, model: e.target.value })}
          placeholder={value.provider === 'openai' ? 'text-embedding-3-small' : 'nomic-embed-text'}
        />
      </div>
      {value.provider !== 'ollama' && (
        <div className="col-span-2">
          <label className={lbl}>API Key</label>
          <input
            className={`${inp} font-mono`}
            type="password"
            value={value.apiKey ?? ''}
            onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
            placeholder="sk-…"
          />
        </div>
      )}
      {(value.provider === 'ollama' || value.provider === 'custom') && (
        <div className="col-span-2">
          <label className={lbl}>Base URL</label>
          <input
            className={`${inp} font-mono`}
            value={value.baseURL ?? ''}
            onChange={(e) => onChange({ ...value, baseURL: e.target.value })}
            placeholder="http://localhost:11434"
          />
        </div>
      )}
    </div>
  )

  if (bordered) {
    return (
      <div className="p-3 bg-surface-200 rounded-lg border border-border">
        {inner}
      </div>
    )
  }
  return inner
}
