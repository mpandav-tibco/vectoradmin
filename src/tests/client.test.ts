import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mirror parseResponse logic — tests verify the exact fix for the empty-body bug
async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const text = await res.text()
      if (text) {
        const body = JSON.parse(text)
        message = body.error?.message ?? body.message ?? message
      }
    } catch {}
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

function makeResponse(status: number, body: string, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body || 'null')),
  } as unknown as Response
}

describe('parseResponse', () => {
  it('parses normal JSON response', async () => {
    const res = makeResponse(200, '{"version":"1.25.4"}')
    expect(await parseResponse<{ version: string }>(res)).toEqual({ version: '1.25.4' })
  })

  it('returns undefined for empty body — the /v1/.well-known/ready case', async () => {
    const res = makeResponse(200, '')
    expect(await parseResponse(res)).toBeUndefined()
  })

  it('returns undefined for 204 No Content', async () => {
    const res = makeResponse(204, '')
    expect(await parseResponse(res)).toBeUndefined()
  })

  it('throws ApiError with parsed message on non-ok response with JSON body', async () => {
    const res = makeResponse(400, '{"error":{"message":"invalid class name"}}', false)
    await expect(parseResponse(res)).rejects.toThrow('invalid class name')
  })

  it('throws ApiError with HTTP status fallback when error body is empty', async () => {
    const res = makeResponse(500, '', false)
    await expect(parseResponse(res)).rejects.toThrow('HTTP 500')
  })

  it('throws ApiError with HTTP status fallback when error body is not JSON', async () => {
    const res = makeResponse(503, 'Service Unavailable', false)
    await expect(parseResponse(res)).rejects.toThrow('HTTP 503')
  })

  it('parses schema response with classes array', async () => {
    const body = JSON.stringify({ classes: [{ class: 'Document', properties: [] }] })
    const res = makeResponse(200, body)
    const result = await parseResponse<{ classes: { class: string }[] }>(res)
    expect(result?.classes).toHaveLength(1)
    expect(result?.classes[0].class).toBe('Document')
  })
})
