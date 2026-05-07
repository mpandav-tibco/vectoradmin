/**
 * Unit tests for src/store/connectionStore.ts
 * Tests state mutations directly via Zustand's getState/setState APIs.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useConnectionStore } from '@/store/connectionStore'
import type { ConnectionConfig } from '@/types/domain'

const WEAVIATE: ConnectionConfig = {
  dbType: 'weaviate', host: 'localhost', port: 8080, scheme: 'http',
}
const QDRANT: ConnectionConfig = {
  dbType: 'qdrant', host: 'qdrant.local', port: 6333, scheme: 'http',
}
const CHROMA: ConnectionConfig = {
  dbType: 'chroma', host: 'chroma.local', port: 8000, scheme: 'http',
}

function state() { return useConnectionStore.getState() }

beforeEach(() => {
  localStorage.clear()
  useConnectionStore.setState({
    config: null, status: 'idle', error: null, version: null, savedConnections: [],
  })
})

// ── setConfig ─────────────────────────────────────────────────────────────────

describe('connectionStore.setConfig', () => {
  it('sets config and transitions status to connecting', () => {
    state().setConfig(WEAVIATE)
    expect(state().config).toEqual(WEAVIATE)
    expect(state().status).toBe('connecting')
  })

  it('clears error when config is set', () => {
    useConnectionStore.setState({ error: 'previous error' })
    state().setConfig(WEAVIATE)
    expect(state().error).toBeNull()
  })
})

// ── setStatus ─────────────────────────────────────────────────────────────────

describe('connectionStore.setStatus', () => {
  it('sets status to connected', () => {
    state().setStatus('connected')
    expect(state().status).toBe('connected')
  })

  it('sets status with error message', () => {
    state().setStatus('error', 'connection refused')
    expect(state().status).toBe('error')
    expect(state().error).toBe('connection refused')
  })

  it('sets version string', () => {
    state().setStatus('connected', undefined, '1.24.1')
    expect(state().version).toBe('1.24.1')
  })

  it('clears error when status transitions away from error', () => {
    useConnectionStore.setState({ error: 'old error' })
    state().setStatus('connected', undefined)
    expect(state().error).toBeNull()
  })
})

// ── disconnect ────────────────────────────────────────────────────────────────

describe('connectionStore.disconnect', () => {
  it('clears config, resets status to idle, and clears error/version', () => {
    useConnectionStore.setState({ config: WEAVIATE, status: 'connected', error: 'e', version: '1.0' })
    state().disconnect()
    expect(state().config).toBeNull()
    expect(state().status).toBe('idle')
    expect(state().error).toBeNull()
    expect(state().version).toBeNull()
  })

  it('does not clear savedConnections', () => {
    state().saveConnection(WEAVIATE)
    state().disconnect()
    expect(state().savedConnections).toHaveLength(1)
  })
})

// ── saveConnection ────────────────────────────────────────────────────────────

describe('connectionStore.saveConnection', () => {
  it('adds a new connection with auto-generated label', () => {
    state().saveConnection(WEAVIATE)
    expect(state().savedConnections).toHaveLength(1)
    expect(state().savedConnections[0].label).toContain('weaviate')
    expect(state().savedConnections[0].label).toContain('localhost')
    expect(state().savedConnections[0].label).toContain('8080')
  })

  it('uses provided label when given', () => {
    state().saveConnection(WEAVIATE, 'My Weaviate')
    expect(state().savedConnections[0].label).toBe('My Weaviate')
  })

  it('deduplicates by host+port+dbType — upserts existing entry', () => {
    state().saveConnection(WEAVIATE, 'First')
    state().saveConnection(WEAVIATE, 'Updated')
    expect(state().savedConnections).toHaveLength(1)
    expect(state().savedConnections[0].label).toBe('Updated')
  })

  it('adds a second entry for a different host', () => {
    state().saveConnection(WEAVIATE)
    state().saveConnection(QDRANT)
    expect(state().savedConnections).toHaveLength(2)
  })

  it('adds a second entry for same host but different dbType', () => {
    state().saveConnection(WEAVIATE)
    state().saveConnection({ ...WEAVIATE, dbType: 'qdrant' })
    expect(state().savedConnections).toHaveLength(2)
  })

  it('includes all connection config fields in saved entry', () => {
    const cfg: ConnectionConfig = { ...WEAVIATE, apiKey: 'secret', proxyURL: '/api/weaviate' }
    state().saveConnection(cfg)
    const saved = state().savedConnections[0]
    expect(saved.apiKey).toBe('secret')
    expect(saved.proxyURL).toBe('/api/weaviate')
  })
})

// ── updateConnection ──────────────────────────────────────────────────────────

describe('connectionStore.updateConnection', () => {
  it('updates label of connection at given index', () => {
    state().saveConnection(WEAVIATE, 'Original')
    state().updateConnection(0, { label: 'Renamed' })
    expect(state().savedConnections[0].label).toBe('Renamed')
  })

  it('can patch any field', () => {
    state().saveConnection(WEAVIATE)
    state().updateConnection(0, { host: 'new-host.local', port: 9999 })
    const saved = state().savedConnections[0]
    expect(saved.host).toBe('new-host.local')
    expect(saved.port).toBe(9999)
  })

  it('only updates the targeted index', () => {
    state().saveConnection(WEAVIATE, 'A')
    state().saveConnection(QDRANT, 'B')
    state().updateConnection(0, { label: 'A-renamed' })
    expect(state().savedConnections[0].label).toBe('A-renamed')
    expect(state().savedConnections[1].label).toBe('B')
  })
})

// ── deleteConnection ──────────────────────────────────────────────────────────

describe('connectionStore.deleteConnection', () => {
  it('removes entry at the given index', () => {
    state().saveConnection(WEAVIATE)
    state().saveConnection(QDRANT)
    state().saveConnection(CHROMA)
    state().deleteConnection(1)
    const names = state().savedConnections.map((c) => c.dbType)
    expect(names).toEqual(['weaviate', 'chroma'])
  })

  it('removing the only entry results in empty array', () => {
    state().saveConnection(WEAVIATE)
    state().deleteConnection(0)
    expect(state().savedConnections).toHaveLength(0)
  })
})

// ── partialize ────────────────────────────────────────────────────────────────

describe('connectionStore partialize (localStorage)', () => {
  it('persists config and savedConnections to localStorage on state change', () => {
    state().setConfig(WEAVIATE)
    state().setStatus('connected')
    state().saveConnection(QDRANT, 'Qdrant node')
    const stored = JSON.parse(localStorage.getItem('vector-admin-connection') ?? '{}')
    expect(stored.state?.config).toBeDefined()
    expect(stored.state?.savedConnections).toHaveLength(1)
  })

  it('does not persist transient fields (status, error, version)', () => {
    state().setStatus('error', 'bad connection', '1.0')
    const stored = JSON.parse(localStorage.getItem('vector-admin-connection') ?? '{}')
    expect(stored.state?.status).toBeUndefined()
    expect(stored.state?.error).toBeUndefined()
    expect(stored.state?.version).toBeUndefined()
  })
})
