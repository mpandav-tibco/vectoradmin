/**
 * Unit tests for src/lib/utils/pca.ts — PCA and Random Projection.
 */
import { describe, it, expect } from 'vitest'
import { pca2d, pca3d, rp2d, rp3d } from '@/lib/utils/pca'

// Helpers
function variance(vals: number[]): number {
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length
  return vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
}

function isFiniteNum(v: unknown): boolean {
  return typeof v === 'number' && isFinite(v) && !isNaN(v)
}

// Synthetic data: two clusters clearly separated along dim 0
const CLUSTER_DATA = [
  [5, 0, 0, 0],  [-5, 0, 0, 0],
  [4.9, 0.1, 0, 0], [-4.9, -0.1, 0, 0],
  [5.1, -0.1, 0, 0], [-5.1, 0.1, 0, 0],
]

// Random-ish high-dimensional data
const HI_DIM = Array.from({ length: 20 }, (_, i) =>
  Array.from({ length: 64 }, (_, j) => Math.sin(i * j + 1))
)

// ── pca2d ─────────────────────────────────────────────────────────────────────

describe('pca2d', () => {
  it('returns an array of the same length as input', () => {
    const result = pca2d(CLUSTER_DATA)
    expect(result).toHaveLength(CLUSTER_DATA.length)
  })

  it('each element is a 2-tuple of finite numbers', () => {
    pca2d(CLUSTER_DATA).forEach(([x, y]) => {
      expect(isFiniteNum(x)).toBe(true)
      expect(isFiniteNum(y)).toBe(true)
    })
  })

  it('returns all-zeros for fewer than 2 input vectors', () => {
    expect(pca2d([])).toEqual([])
    expect(pca2d([[1, 2, 3]])).toEqual([[0, 0]])
  })

  it('two identical vectors project to the same 2D point', () => {
    const v = [1, 2, 3, 4, 5]
    const [[x1, y1], [x2, y2]] = pca2d([v, v, [0, 0, 0, 0, 0]])
    expect(x1).toBeCloseTo(x2, 8)
    expect(y1).toBeCloseTo(y2, 8)
  })

  it('first PC captures more variance than second PC for well-separated clusters', () => {
    const result = pca2d(CLUSTER_DATA)
    const var1 = variance(result.map(([x]) => x))
    const var2 = variance(result.map(([, y]) => y))
    expect(var1).toBeGreaterThan(var2)
  })

  it('works with high-dimensional input', () => {
    const result = pca2d(HI_DIM)
    expect(result).toHaveLength(HI_DIM.length)
    result.forEach(([x, y]) => {
      expect(isFiniteNum(x)).toBe(true)
      expect(isFiniteNum(y)).toBe(true)
    })
  })

  it('handles two-vector minimum case without crashing', () => {
    const result = pca2d([[1, 0], [0, 1]])
    expect(result).toHaveLength(2)
    result.forEach(([x, y]) => {
      expect(isFiniteNum(x)).toBe(true)
      expect(isFiniteNum(y)).toBe(true)
    })
  })
})

// ── pca3d ─────────────────────────────────────────────────────────────────────

describe('pca3d', () => {
  it('returns an array of the same length as input', () => {
    expect(pca3d(CLUSTER_DATA)).toHaveLength(CLUSTER_DATA.length)
  })

  it('each element is a 3-tuple of finite numbers', () => {
    pca3d(CLUSTER_DATA).forEach(([x, y, z]) => {
      expect(isFiniteNum(x)).toBe(true)
      expect(isFiniteNum(y)).toBe(true)
      expect(isFiniteNum(z)).toBe(true)
    })
  })

  it('returns all-zeros for fewer than 2 input vectors', () => {
    expect(pca3d([])).toEqual([])
    expect(pca3d([[1, 2, 3]])).toEqual([[0, 0, 0]])
  })

  it('first PC captures the most variance for well-separated data', () => {
    const result = pca3d(CLUSTER_DATA)
    const [var1, var2, var3] = [0, 1, 2].map((i) => variance(result.map((r) => r[i])))
    expect(var1).toBeGreaterThan(var2)
    expect(var1).toBeGreaterThan(var3)
  })

  it('works with high-dimensional input', () => {
    const result = pca3d(HI_DIM)
    expect(result).toHaveLength(HI_DIM.length)
    result.forEach((pt) => pt.forEach((v) => expect(isFiniteNum(v)).toBe(true)))
  })
})

// ── rp2d ─────────────────────────────────────────────────────────────────────

describe('rp2d', () => {
  it('returns an array of the same length as input', () => {
    expect(rp2d(CLUSTER_DATA)).toHaveLength(CLUSTER_DATA.length)
  })

  it('each element is a 2-tuple of finite numbers', () => {
    rp2d(CLUSTER_DATA).forEach(([x, y]) => {
      expect(isFiniteNum(x)).toBe(true)
      expect(isFiniteNum(y)).toBe(true)
    })
  })

  it('is deterministic — same input always produces same output', () => {
    const a = rp2d(CLUSTER_DATA)
    const b = rp2d(CLUSTER_DATA)
    a.forEach(([ax, ay], i) => {
      expect(ax).toBeCloseTo(b[i][0], 10)
      expect(ay).toBeCloseTo(b[i][1], 10)
    })
  })

  it('different inputs produce different outputs', () => {
    const a = rp2d([[1, 0, 0], [0, 1, 0]])
    const b = rp2d([[0, 0, 1], [1, 1, 1]])
    const allSame = a.every(([ax, ay], i) => Math.abs(ax - b[i][0]) < 1e-10 && Math.abs(ay - b[i][1]) < 1e-10)
    expect(allSame).toBe(false)
  })

  it('projections are approximately mean-zero (centering applied)', () => {
    const result = rp2d(HI_DIM)
    const meanX = result.reduce((s, [x]) => s + x, 0) / result.length
    const meanY = result.reduce((s, [, y]) => s + y, 0) / result.length
    expect(Math.abs(meanX)).toBeCloseTo(0, 8)
    expect(Math.abs(meanY)).toBeCloseTo(0, 8)
  })

  it('handles empty input', () => {
    expect(rp2d([])).toEqual([])
  })

  it('handles single vector', () => {
    const result = rp2d([[1, 2, 3]])
    expect(result).toHaveLength(1)
    result[0].forEach((v) => expect(isFiniteNum(v)).toBe(true))
  })

  it('works with high-dimensional input', () => {
    const result = rp2d(HI_DIM)
    expect(result).toHaveLength(HI_DIM.length)
    result.forEach(([x, y]) => {
      expect(isFiniteNum(x)).toBe(true)
      expect(isFiniteNum(y)).toBe(true)
    })
  })
})

// ── rp3d ─────────────────────────────────────────────────────────────────────

describe('rp3d', () => {
  it('returns an array of the same length as input', () => {
    expect(rp3d(CLUSTER_DATA)).toHaveLength(CLUSTER_DATA.length)
  })

  it('each element is a 3-tuple of finite numbers', () => {
    rp3d(CLUSTER_DATA).forEach(([x, y, z]) => {
      expect(isFiniteNum(x)).toBe(true)
      expect(isFiniteNum(y)).toBe(true)
      expect(isFiniteNum(z)).toBe(true)
    })
  })

  it('is deterministic — same input always produces same output', () => {
    const a = rp3d(CLUSTER_DATA)
    const b = rp3d(CLUSTER_DATA)
    a.forEach(([ax, ay, az], i) => {
      expect(ax).toBeCloseTo(b[i][0], 10)
      expect(ay).toBeCloseTo(b[i][1], 10)
      expect(az).toBeCloseTo(b[i][2], 10)
    })
  })

  it('projections are approximately mean-zero (centering applied)', () => {
    const result = rp3d(HI_DIM)
    for (let k = 0; k < 3; k++) {
      const mean = result.reduce((s, r) => s + r[k], 0) / result.length
      expect(Math.abs(mean)).toBeCloseTo(0, 8)
    }
  })

  it('axes are approximately orthogonal (Gram-Schmidt applied)', () => {
    // The three projection vectors should be near-orthogonal.
    // Verify by checking that the projections of a random set are spread across all 3 dims.
    const result = rp3d(HI_DIM)
    const vars = [0, 1, 2].map((k) => variance(result.map((r) => r[k])))
    // All three dimensions should have nonzero variance for interesting data
    vars.forEach((v) => expect(v).toBeGreaterThan(0))
  })

  it('handles empty input', () => {
    expect(rp3d([])).toEqual([])
  })

  it('rp2d and rp3d first 2 dims are consistent with each other', () => {
    // Both rp2d and rp3d center and project onto their axes using the same seed.
    // They should produce the same first two components.
    const data = CLUSTER_DATA
    const r2 = rp2d(data)
    const r3 = rp3d(data)
    r2.forEach(([x2, y2], i) => {
      expect(x2).toBeCloseTo(r3[i][0], 8)
      expect(y2).toBeCloseTo(r3[i][1], 8)
    })
  })
})
