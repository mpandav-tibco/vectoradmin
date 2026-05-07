function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return n < 1e-10 ? v : v.map((x) => x / n)
}

// Power iteration to find the dominant eigenvector of XᵀX.
function powerIterate(X: number[][], d: number, iters = 80): number[] {
  let v = normalize(Array.from({ length: d }, () => Math.random() - 0.5))
  for (let it = 0; it < iters; it++) {
    const w = X.map((row) => dot(row, v))      // Xv  → n-vec
    const u = new Array<number>(d).fill(0)
    for (let i = 0; i < X.length; i++)
      for (let j = 0; j < d; j++)
        u[j] += w[i] * X[i][j]                 // XᵀXv → d-vec
    const next = normalize(u)
    if (dot(next, v) > 1 - 1e-9) break
    v = next
  }
  return v
}

function centerAndDeflate(vectors: number[][], d: number): { X: number[][]; mean: number[] } {
  const n = vectors.length
  const mean = new Array<number>(d).fill(0)
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j]
  for (let j = 0; j < d; j++) mean[j] /= n
  const X = vectors.map((v) => v.map((x, j) => x - mean[j]))
  return { X, mean }
}

function deflate(X: number[][], pc: number[]): number[][] {
  return X.map((v) => { const p = dot(v, pc); return v.map((x, j) => x - p * pc[j]) })
}

/**
 * Project `vectors` onto their top-2 principal components.
 * Returns one [x, y] pair per input vector.
 * Runs synchronously — cap input at ~1000 vectors to stay under ~300ms.
 */
export function pca2d(vectors: number[][]): Array<[number, number]> {
  if (vectors.length < 2) return vectors.map(() => [0, 0])
  const d = vectors[0].length
  const { X, mean } = centerAndDeflate(vectors, d)
  const pc1 = powerIterate(X, d)
  const pc2 = powerIterate(deflate(X, pc1), d)
  return vectors.map((v) => {
    const c = v.map((x, j) => x - mean[j])
    return [dot(c, pc1), dot(c, pc2)] as [number, number]
  })
}

/**
 * Project `vectors` onto their top-3 principal components.
 * Returns one [x, y, z] triple per input vector.
 * Runs synchronously — cap input at ~1000 vectors to stay under ~400ms.
 */
export function pca3d(vectors: number[][]): Array<[number, number, number]> {
  if (vectors.length < 2) return vectors.map(() => [0, 0, 0])
  const d = vectors[0].length
  const { X, mean } = centerAndDeflate(vectors, d)
  const pc1 = powerIterate(X, d)
  const X2 = deflate(X, pc1)
  const pc2 = powerIterate(X2, d)
  const pc3 = powerIterate(deflate(X2, pc2), d)
  return vectors.map((v) => {
    const c = v.map((x, j) => x - mean[j])
    return [dot(c, pc1), dot(c, pc2), dot(c, pc3)] as [number, number, number]
  })
}
