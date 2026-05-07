import type { ConnectionConfig } from '@/types/domain'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export function buildBaseURL(config?: ConnectionConfig | null): string {
  if (!config) return '/api/weaviate'                          // dev-proxy fallback
  if (config.proxyURL) return config.proxyURL.replace(/\/$/, '') // explicit proxy
  return `${config.scheme}://${config.host}:${config.port}`   // direct connection
}

function buildHeaders(config?: ConnectionConfig | null): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (config?.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`
  return headers
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const text = await res.text()
      if (text) {
        try {
          const body = JSON.parse(text)
          // Weaviate returns errors as an array: {"error": [{"message": "..."}]}
          const errArr = Array.isArray(body.error) ? body.error : null
          message = errArr?.[0]?.message ?? body.error?.message ?? body.message ?? text.slice(0, 300) ?? message
        } catch {
          message = text.slice(0, 300) || message
        }
      }
    } catch {}
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(res.status, `Weaviate returned non-JSON — check host, port and proxy settings`)
  }
}

export const weaviateApi = {
  async get<T>(path: string, config?: ConnectionConfig | null): Promise<T> {
    const res = await fetch(`${buildBaseURL(config)}${path}`, {
      headers: buildHeaders(config),
    })
    return parseResponse<T>(res)
  },

  async post<T>(path: string, body: unknown, config?: ConnectionConfig | null): Promise<T> {
    const res = await fetch(`${buildBaseURL(config)}${path}`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
    })
    return parseResponse<T>(res)
  },

  async put<T>(path: string, body: unknown, config?: ConnectionConfig | null): Promise<T> {
    const res = await fetch(`${buildBaseURL(config)}${path}`, {
      method: 'PUT',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
    })
    return parseResponse<T>(res)
  },

  async patch<T>(path: string, body: unknown, config?: ConnectionConfig | null): Promise<T> {
    const res = await fetch(`${buildBaseURL(config)}${path}`, {
      method: 'PATCH',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
    })
    return parseResponse<T>(res)
  },

  async delete(path: string, config?: ConnectionConfig | null): Promise<void> {
    const res = await fetch(`${buildBaseURL(config)}${path}`, {
      method: 'DELETE',
      headers: buildHeaders(config),
    })
    if (!res.ok && res.status !== 404) {
      throw new ApiError(res.status, `DELETE failed: HTTP ${res.status}`)
    }
  },
}
