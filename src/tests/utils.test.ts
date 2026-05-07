import { describe, it, expect } from 'vitest'
import {
  formatBytes, formatDuration, truncate, formatNumber,
  formatDate, generateId, isValidUUID,
} from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'

describe('formatBytes', () => {
  it('returns "0 B" for zero', () => { expect(formatBytes(0)).toBe('0 B') })
  it('formats plain bytes', () => { expect(formatBytes(512)).toBe('512 B') })
  it('formats kilobytes', () => { expect(formatBytes(1024)).toBe('1 KB') })
  it('formats megabytes', () => { expect(formatBytes(1024 * 1024)).toBe('1 MB') })
  it('formats gigabytes', () => { expect(formatBytes(1024 ** 3)).toBe('1 GB') })
  it('rounds to one decimal place', () => { expect(formatBytes(1536)).toBe('1.5 KB') })
})

describe('formatDuration', () => {
  it('shows ms under 1 second', () => { expect(formatDuration(250)).toBe('250ms') })
  it('shows seconds 1s–59s', () => {
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(2500)).toBe('2.5s')
  })
  it('shows minutes at 60s+', () => { expect(formatDuration(90000)).toBe('1.5m') })
  it('boundary: exactly 1000ms shows seconds', () => { expect(formatDuration(1000)).toBe('1.0s') })
})

describe('truncate', () => {
  it('returns string unchanged when within limit', () => { expect(truncate('hello', 10)).toBe('hello') })
  it('returns string unchanged at exact limit', () => { expect(truncate('hello', 5)).toBe('hello') })
  it('truncates and appends ellipsis when over limit', () => { expect(truncate('hello world', 5)).toBe('hello…') })
  it('handles empty string', () => { expect(truncate('', 5)).toBe('') })
  it('truncates to 1 character', () => { expect(truncate('abc', 1)).toBe('a…') })
})

describe('formatNumber', () => {
  it('returns plain number below 1 000', () => { expect(formatNumber(999)).toBe('999') })
  it('formats thousands as K', () => {
    expect(formatNumber(1000)).toBe('1.0K')
    expect(formatNumber(1500)).toBe('1.5K')
  })
  it('formats millions as M', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M')
    expect(formatNumber(2_500_000)).toBe('2.5M')
  })
})

describe('formatDate', () => {
  it('returns a non-empty string for epoch', () => {
    const result = formatDate(0)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
  it('returns different strings for different timestamps', () => {
    const a = formatDate(1_700_000_000_000)
    const b = formatDate(1_700_000_060_000)
    expect(a).not.toBe(b)
  })
})

describe('generateId', () => {
  it('returns a valid UUID', () => { expect(isValidUUID(generateId())).toBe(true) })
  it('returns unique IDs on successive calls', () => {
    const ids = new Set(Array.from({ length: 20 }, generateId))
    expect(ids.size).toBe(20)
  })
})

describe('isValidUUID', () => {
  it('accepts valid lowercase UUID', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })
  it('accepts valid uppercase UUID', () => {
    expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
  })
  it('rejects empty string', () => { expect(isValidUUID('')).toBe(false) })
  it('rejects plain word', () => { expect(isValidUUID('not-a-uuid')).toBe(false) })
  it('rejects truncated UUID', () => { expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false) })
  it('rejects UUID with non-hex chars', () => {
    expect(isValidUUID('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBe(false)
  })
})

describe('cn', () => {
  it('joins class names', () => { expect(cn('foo', 'bar')).toBe('foo bar') })
  it('ignores falsy values', () => {
    expect(cn('foo', false, null, undefined, '', 'bar')).toBe('foo bar')
  })
  it('merges conflicting Tailwind classes — last wins', () => {
    expect(cn('text-sm', 'text-lg')).toBe('text-lg')
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
  it('accepts array syntax', () => { expect(cn(['foo', 'bar'])).toBe('foo bar') })
  it('accepts object syntax', () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz')
  })
})
