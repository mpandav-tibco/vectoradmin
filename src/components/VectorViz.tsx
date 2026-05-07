import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { useConnectionStore } from '@/store/connectionStore'
import { getAdapter } from '@/lib/adapters'
import { pca3d } from '@/lib/utils/pca'
import { cn } from '@/lib/utils/cn'

const MAX_SAMPLES = 500
const PALETTE = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#14b8a6', '#f97316', '#ec4899', '#0ea5e9', '#84cc16',
]

// ── 3D math ─────────────────────────────────────────────────────────────────

type Vec3 = [number, number, number]

function rotY(t: number, [x, y, z]: Vec3): Vec3 {
  return [x * Math.cos(t) + z * Math.sin(t), y, -x * Math.sin(t) + z * Math.cos(t)]
}
function rotX(t: number, [x, y, z]: Vec3): Vec3 {
  return [x, y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)]
}

// Normalize to [-0.9, 0.9] preserving aspect ratio (PCA variance scale intact).
function normCoords3d(pts: Vec3[]): Vec3[] {
  let maxAbs = 0
  for (const [x, y, z] of pts) maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y), Math.abs(z))
  if (maxAbs < 1e-10) return pts
  const s = 0.9 / maxAbs
  return pts.map(([x, y, z]) => [x * s, y * s, z * s])
}

// Normalize each axis independently to [0, 1] for 2D SVG.
function normCoords2d(pts: [number, number][]): Array<{ px: number; py: number }> {
  if (pts.length === 0) return []
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const rx = maxX - minX || 1, ry = maxY - minY || 1
  return pts.map(([x, y]) => ({ px: (x - minX) / rx, py: (y - minY) / ry }))
}

interface PointMeta { id: string; properties: Record<string, unknown> }

// ── Canvas3D ─────────────────────────────────────────────────────────────────

const CANVAS_SIZE = 480
const FOV = 2.2
const AXIS_DIRS: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const AXIS_LABELS = ['PC1', 'PC2', 'PC3']

function Canvas3D({ coords, getColor, onHoverChange }: {
  coords: Vec3[]
  getColor: (i: number) => string
  onHoverChange: (i: number | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const st = useRef({ theta: 0.5, phi: -0.3, dragging: false, last: { x: 0, y: 0 }, hovered: null as number | null })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = CANVAS_SIZE * dpr
    canvas.height = CANVAS_SIZE * dpr
    ctx.scale(dpr, dpr)

    const { theta, phi, hovered } = st.current
    const cx = CANVAS_SIZE / 2
    const cy = CANVAS_SIZE / 2
    const scale = CANVAS_SIZE * 0.38

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // Axes
    for (let a = 0; a < 3; a++) {
      const [rx, ry, rz] = rotX(phi, rotY(theta, AXIS_DIRS[a]))
      const sz = FOV / (FOV + rz + 1)
      const ex = cx + rx * scale * 0.82 * sz
      const ey = cy - ry * scale * 0.82 * sz
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(ex, ey)
      ctx.strokeStyle = '#374151'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#6b7280'
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillText(AXIS_LABELS[a], ex + 4, ey + 4)
    }

    // Project + sort back-to-front
    const projected = coords.map((pt, i) => {
      const [rx, ry, rz] = rotX(phi, rotY(theta, pt))
      const sz = FOV / (FOV + rz + 1)
      return { sx: cx + rx * scale * sz, sy: cy - ry * scale * sz, depth: rz, i }
    })
    projected.sort((a, b) => a.depth - b.depth)

    for (const { sx, sy, depth, i } of projected) {
      const nd = Math.max(0, Math.min(1, (depth + 0.9) / 1.8))
      const r = 2.5 + nd * 2.5
      const isHov = hovered === i
      ctx.beginPath()
      ctx.arc(sx, sy, isHov ? r + 2 : r, 0, Math.PI * 2)
      ctx.globalAlpha = isHov ? 0.95 : 0.28 + nd * 0.62
      ctx.fillStyle = getColor(i)
      ctx.fill()
      if (isHov) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = '#f8fafc'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
  }, [coords, getColor])

  useEffect(() => { draw() }, [draw])

  function pickHovered(mx: number, my: number): number | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const cx = CANVAS_SIZE / 2, cy = CANVAS_SIZE / 2
    const scale = CANVAS_SIZE * 0.38
    const { theta, phi } = st.current
    const scaleX = CANVAS_SIZE / rect.width
    const scaleY = CANVAS_SIZE / rect.height
    const cmx = (mx - rect.left) * scaleX
    const cmy = (my - rect.top) * scaleY
    let best = -1, bestD = 14
    for (let i = 0; i < coords.length; i++) {
      const [rx, ry, rz] = rotX(phi, rotY(theta, coords[i]))
      const sz = FOV / (FOV + rz + 1)
      const d = Math.hypot(cmx - (cx + rx * scale * sz), cmy - (cy - ry * scale * sz))
      if (d < bestD) { bestD = d; best = i }
    }
    return best === -1 ? null : best
  }

  const onMouseDown = (e: React.MouseEvent) => {
    st.current.dragging = true
    st.current.last = { x: e.clientX, y: e.clientY }
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (st.current.dragging) {
      const dx = e.clientX - st.current.last.x
      const dy = e.clientY - st.current.last.y
      st.current.theta += dx * 0.008
      st.current.phi = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, st.current.phi + dy * 0.008))
      st.current.last = { x: e.clientX, y: e.clientY }
      draw()
    } else {
      const idx = pickHovered(e.clientX, e.clientY)
      if (idx !== st.current.hovered) {
        st.current.hovered = idx
        onHoverChange(idx)
        draw()
      }
    }
  }

  const onMouseUp = () => { st.current.dragging = false }

  const onMouseLeave = () => {
    st.current.dragging = false
    if (st.current.hovered !== null) {
      st.current.hovered = null
      onHoverChange(null)
      draw()
    }
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', maxWidth: `${CANVAS_SIZE}px`, margin: '0 auto', aspectRatio: '1', cursor: 'grab' }}
      className="active:cursor-grabbing"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    />
  )
}

// ── VectorViz ────────────────────────────────────────────────────────────────

const SVG_SIZE = 480, SVG_PAD = 30, SVG_PLOT = SVG_SIZE - SVG_PAD * 2, DOT_R = 4.5

export function VectorViz({ collectionName }: { collectionName: string }) {
  const { config } = useConnectionStore()
  const [status, setStatus] = useState<'loading' | 'computing' | 'done' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [pointMeta, setPointMeta] = useState<PointMeta[]>([])
  const [coords2d, setCoords2d] = useState<Array<{ px: number; py: number }>>([])
  const [coords3d, setCoords3d] = useState<Vec3[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [colorField, setColorField] = useState('')
  const [propertyKeys, setPropertyKeys] = useState<string[]>([])
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [mode, setMode] = useState<'2d' | '3d'>('3d')

  const load = useCallback(async () => {
    if (!config) return
    setStatus('loading')
    setError(null)
    setPointMeta([])
    setCoords2d([])
    setCoords3d([])
    try {
      const adapter = getAdapter(config)
      const { objects, total } = await adapter.listObjects(collectionName, MAX_SAMPLES, 0)
      setTotalCount(total)

      const withVecs = objects.filter(
        (o): o is typeof o & { vector: number[] } => Array.isArray(o.vector) && o.vector.length > 0
      )

      if (withVecs.length < 2) {
        setError(
          `Found ${withVecs.length} object(s) with stored vectors — need at least 2. ` +
          `Some databases only return vectors at query time, or this collection has no stored embeddings.`
        )
        setStatus('error')
        return
      }

      const keys = Array.from(new Set(withVecs.flatMap((o) => Object.keys(o.properties)))).slice(0, 20)
      setPropertyKeys(keys)
      setColorField((cf) => (keys.includes(cf) ? cf : keys[0] ?? ''))

      setStatus('computing')
      await new Promise<void>((r) => setTimeout(r, 0))

      const raw3d = pca3d(withVecs.map((o) => o.vector))
      const c3d = normCoords3d(raw3d)
      const c2d = normCoords2d(c3d.map(([x, y]) => [x, y]))

      setPointMeta(withVecs.map((o) => ({ id: o.id, properties: o.properties })))
      setCoords3d(c3d)
      setCoords2d(c2d)
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load vectors')
      setStatus('error')
    }
  }, [config, collectionName])

  useEffect(() => { load() }, [load])

  const { colorMap, colorValues } = useMemo(() => {
    if (!colorField || pointMeta.length === 0) return { colorMap: new Map<string, string>(), colorValues: [] as string[] }
    const unique = Array.from(new Set(pointMeta.map((p) => String(p.properties[colorField] ?? '')))).slice(0, PALETTE.length)
    return { colorMap: new Map(unique.map((v, i) => [v, PALETTE[i]])), colorValues: unique }
  }, [pointMeta, colorField])

  const getColor = useCallback((i: number): string => {
    if (!colorField || !pointMeta[i]) return PALETTE[0]
    return colorMap.get(String(pointMeta[i].properties[colorField] ?? '')) ?? PALETTE[0]
  }, [colorField, colorMap, pointMeta])

  const hoveredPoint = hoveredIdx !== null ? pointMeta[hoveredIdx] : null
  const svgX = (px: number) => SVG_PAD + px * SVG_PLOT
  const svgY = (py: number) => SVG_SIZE - SVG_PAD - py * SVG_PLOT

  return (
    <div className="space-y-4" onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}>
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {status === 'done' && (
          <div className="flex rounded-md overflow-hidden border border-border text-xs font-medium">
            {(['3d', '2d'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-3 py-1.5 uppercase tracking-wide transition-colors',
                  mode === m ? 'bg-accent text-white' : 'bg-surface-200 text-gray-400 hover:text-gray-100'
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {propertyKeys.length > 0 && status === 'done' && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Color by</label>
            <select
              className="input py-1 text-xs"
              value={colorField}
              onChange={(e) => setColorField(e.target.value)}
            >
              <option value="">— none —</option>
              {propertyKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
        )}

        <button
          onClick={load}
          disabled={status === 'loading' || status === 'computing'}
          className="btn-ghost text-xs"
          title="Re-fetch and recompute"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', (status === 'loading' || status === 'computing') && 'animate-spin')} />
        </button>

        {totalCount > MAX_SAMPLES && status === 'done' && (
          <span className="text-xs text-amber-500 ml-auto">
            Showing first {MAX_SAMPLES} of {totalCount} objects
          </span>
        )}
      </div>

      {/* Loading */}
      {(status === 'loading' || status === 'computing') && (
        <div className="card flex flex-col items-center justify-center py-24 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
          <p className="text-sm text-gray-500">
            {status === 'loading' ? 'Fetching vectors…' : 'Running PCA…'}
          </p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="card flex items-start gap-3 p-5 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p>{error}</p>
            <button onClick={load} className="mt-3 text-xs text-gray-400 hover:text-gray-200 underline underline-offset-2">
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Plot */}
      {status === 'done' && pointMeta.length > 0 && (
        <div className="card overflow-hidden">
          {/* 3D canvas */}
          {mode === '3d' && (
            <div>
              <p className="text-center text-xs text-gray-600 pt-3 pb-1">Drag to rotate · Hover a point for details</p>
              <Canvas3D coords={coords3d} getColor={getColor} onHoverChange={setHoveredIdx} />
            </div>
          )}

          {/* 2D SVG */}
          {mode === '2d' && (
            <svg
              viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
              className="w-full max-w-2xl mx-auto block"
              style={{ aspectRatio: '1' }}
            >
              {[0.25, 0.5, 0.75].map((t) => (
                <g key={t}>
                  <line x1={svgX(t)} y1={SVG_PAD} x2={svgX(t)} y2={SVG_SIZE - SVG_PAD} stroke="#374151" strokeWidth={0.5} strokeDasharray="3,3" />
                  <line x1={SVG_PAD} y1={svgY(t)} x2={SVG_SIZE - SVG_PAD} y2={svgY(t)} stroke="#374151" strokeWidth={0.5} strokeDasharray="3,3" />
                </g>
              ))}
              <text x={SVG_SIZE / 2} y={SVG_SIZE - 6} fill="#4b5563" fontSize={11} textAnchor="middle">PC 1</text>
              <text x={12} y={SVG_SIZE / 2} fill="#4b5563" fontSize={11} textAnchor="middle" transform={`rotate(-90 12 ${SVG_SIZE / 2})`}>PC 2</text>
              {coords2d.map((c, i) => (
                <circle
                  key={pointMeta[i].id}
                  cx={svgX(c.px)}
                  cy={svgY(c.py)}
                  r={hoveredIdx === i ? DOT_R + 2 : DOT_R}
                  fill={getColor(i)}
                  fillOpacity={hoveredIdx !== null && hoveredIdx !== i ? 0.22 : 0.85}
                  stroke={hoveredIdx === i ? '#f8fafc' : 'none'}
                  strokeWidth={1.5}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              ))}
            </svg>
          )}

          {/* Legend */}
          {colorField && colorValues.length > 0 && (
            <div className="border-t border-border px-4 py-3 flex flex-wrap gap-x-4 gap-y-2">
              {colorValues.map((v, i) => (
                <div key={v} className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PALETTE[i] }} />
                  <span className="truncate max-w-[140px]" title={v || '(empty)'}>{v || '(empty)'}</span>
                </div>
              ))}
              {colorValues.length === PALETTE.length && (
                <span className="text-xs text-gray-600 self-center">… and more</span>
              )}
            </div>
          )}

          <div className="border-t border-border px-4 py-2 text-xs text-gray-600 flex justify-between">
            <span>{pointMeta.length} vectors · PCA {mode.toUpperCase()} projection</span>
            <span>Hover for details</span>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {hoveredPoint && (
        <div
          className="fixed z-50 pointer-events-none bg-surface-100 border border-border rounded-lg shadow-xl p-3 text-xs max-w-xs"
          style={{ left: mousePos.x + 14, top: mousePos.y - 10 }}
        >
          <p className="font-mono text-gray-500 mb-2 truncate max-w-[220px]" title={hoveredPoint.id}>
            {hoveredPoint.id.length > 24
              ? hoveredPoint.id.slice(0, 12) + '…' + hoveredPoint.id.slice(-8)
              : hoveredPoint.id}
          </p>
          {Object.entries(hoveredPoint.properties).slice(0, 5).map(([k, v]) => (
            <div key={k} className="flex gap-2 leading-5">
              <span className="text-gray-500 flex-shrink-0">{k}:</span>
              <span className="text-gray-200 truncate max-w-[160px]">{String(v ?? '').slice(0, 60)}</span>
            </div>
          ))}
          {Object.keys(hoveredPoint.properties).length > 5 && (
            <p className="text-gray-600 mt-1">+{Object.keys(hoveredPoint.properties).length - 5} more</p>
          )}
        </div>
      )}
    </div>
  )
}
