import { describe, it, expect } from 'vitest'
import { chunkText } from '../lib/chunker/index'

const LOREM = `First paragraph with some content here. It has multiple sentences. This is the third one.

Second paragraph that talks about something different. Another sentence follows. And one more.

Third paragraph wrapping up the document. Final sentence here.`

describe('chunkText — fixed strategy', () => {
  it('splits text into chunks of given size', () => {
    const chunks = chunkText('abcdefghij', { strategy: 'fixed', size: 4, overlap: 0 })
    expect(chunks).toHaveLength(3)
    expect(chunks[0].text).toBe('abcd')
    expect(chunks[1].text).toBe('efgh')
    expect(chunks[2].text).toBe('ij')
  })

  it('honours overlap so adjacent chunks share characters', () => {
    const chunks = chunkText('abcdefghij', { strategy: 'fixed', size: 5, overlap: 2 })
    expect(chunks[0].text).toBe('abcde')
    expect(chunks[1].text).toBe('defgh')
  })

  it('assigns sequential indices', () => {
    const chunks = chunkText('abcdefghij', { strategy: 'fixed', size: 3, overlap: 0 })
    chunks.forEach((c, i) => expect(c.index).toBe(i))
  })

  it('returns single chunk when text is shorter than size', () => {
    const chunks = chunkText('hello', { strategy: 'fixed', size: 100, overlap: 0 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe('hello')
  })

  it('returns empty array for empty string', () => {
    const chunks = chunkText('', { strategy: 'fixed', size: 100, overlap: 0 })
    expect(chunks).toHaveLength(0)
  })
})

describe('chunkText — paragraph strategy', () => {
  it('splits on double newlines', () => {
    const chunks = chunkText(LOREM, { strategy: 'paragraph', size: 512, overlap: 0 })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })

  it('does not produce empty chunks', () => {
    const chunks = chunkText(LOREM, { strategy: 'paragraph', size: 512, overlap: 0 })
    chunks.forEach((c) => expect(c.text.trim().length).toBeGreaterThan(0))
  })

  it('respects maxSize by splitting large paragraphs', () => {
    const bigPara = 'word '.repeat(200)
    const chunks = chunkText(bigPara, { strategy: 'paragraph', size: 50, overlap: 0 })
    chunks.forEach((c) => expect(c.text.length).toBeLessThanOrEqual(55))
  })
})

describe('chunkText — sentence strategy', () => {
  it('splits on sentence boundaries', () => {
    const text = 'First sentence. Second sentence. Third sentence.'
    const chunks = chunkText(text, { strategy: 'sentence', size: 512, overlap: 0 })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0].text).toContain('sentence')
  })
})

describe('chunkText — heading strategy', () => {
  it('splits markdown by headings', () => {
    const md = `# Title\n\nSome intro text.\n\n## Section 1\n\nContent here.\n\n## Section 2\n\nMore content.`
    const chunks = chunkText(md, { strategy: 'heading', size: 512, overlap: 0 })
    expect(chunks.length).toBeGreaterThanOrEqual(3)
  })
})
