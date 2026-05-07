import type { ChunkConfig } from '@/types/domain'

export interface Chunk {
  text: string
  index: number
  startChar: number
  endChar: number
}

export function chunkText(text: string, config: ChunkConfig): Chunk[] {
  switch (config.strategy) {
    case 'fixed':
      return chunkFixed(text, config.size, config.overlap)
    case 'sentence':
      return chunkBySentence(text, config.size, config.overlap)
    case 'paragraph':
      return chunkByParagraph(text, config.size, config.overlap)
    case 'heading':
      return chunkByHeading(text, config.size)
    default:
      return chunkFixed(text, config.size, config.overlap)
  }
}

function chunkFixed(text: string, size: number, overlap: number): Chunk[] {
  const chunks: Chunk[] = []
  let i = 0
  while (i < text.length) {
    const end = Math.min(i + size, text.length)
    chunks.push({ text: text.slice(i, end), index: chunks.length, startChar: i, endChar: end })
    i += size - overlap
    if (i >= text.length) break
  }
  return chunks
}

function chunkBySentence(text: string, maxSize: number, overlap: number): Chunk[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text]
  return groupIntoChunks(sentences, text, maxSize, overlap)
}

function chunkByParagraph(text: string, maxSize: number, overlap: number): Chunk[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0)
  return groupIntoChunks(paragraphs, text, maxSize, overlap)
}

function chunkByHeading(text: string, maxSize: number): Chunk[] {
  const sections = text.split(/(?=^#{1,6}\s)/m).filter((s) => s.trim().length > 0)
  const chunks: Chunk[] = []
  for (const section of sections) {
    if (section.length <= maxSize) {
      const start = text.indexOf(section)
      chunks.push({ text: section.trim(), index: chunks.length, startChar: start, endChar: start + section.length })
    } else {
      const sub = chunkFixed(section, maxSize, Math.floor(maxSize * 0.1))
      chunks.push(...sub.map((c) => ({ ...c, index: chunks.length + c.index })))
    }
  }
  return chunks
}

function groupIntoChunks(segments: string[], fullText: string, maxSize: number, overlap: number): Chunk[] {
  const chunks: Chunk[] = []
  let current = ''
  let startChar = 0

  const flush = () => {
    if (current.trim().length === 0) return
    if (current.length > maxSize) {
      // single segment exceeded maxSize — fall back to fixed chunking
      const sub = chunkFixed(current, maxSize, overlap)
      chunks.push(...sub.map((c) => ({ ...c, index: chunks.length + c.index, startChar: startChar + c.startChar, endChar: startChar + c.endChar })))
    } else {
      chunks.push({ text: current.trim(), index: chunks.length, startChar, endChar: startChar + current.length })
    }
    current = ''
  }

  for (const seg of segments) {
    if ((current + seg).length > maxSize && current.length > 0) {
      flush()
      const overlapText = seg.slice(0, overlap)
      startChar = fullText.indexOf(seg)
      current = overlapText + seg
    } else {
      if (current.length === 0) startChar = fullText.indexOf(seg)
      current += seg
    }
  }
  flush()
  return chunks
}

export async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === 'text/plain' || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
    return file.text()
  }
  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    // Basic PDF extraction — in production use pdfjs-dist
    return `[PDF: ${file.name} — install pdfjs-dist for full extraction]`
  }
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.name.endsWith('.docx')
  ) {
    const { extractRawText } = await import('mammoth')
    const arrayBuffer = await file.arrayBuffer()
    const result = await extractRawText({ arrayBuffer })
    return result.value
  }
  if (file.type === 'application/json' || file.name.endsWith('.json')) {
    const text = await file.text()
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }
  return file.text()
}
