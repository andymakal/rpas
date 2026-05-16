'use client'

export type GaugeBand = {
  threshold: number
  color: string
  label: string
}

export const GDC_BANDS: GaugeBand[] = [
  { threshold: 25000,    color: '#94A3B8', label: 'Silver'     },
  { threshold: 50000,    color: '#EAB308', label: 'Yellow'     },
  { threshold: 75000,    color: '#60A5FA', label: 'Light Blue' },
  { threshold: 100000,   color: '#1D4ED8', label: 'Royal Blue' },
  { threshold: Infinity, color: '#16A34A', label: 'Green'      },
]

export const APP_BANDS: GaugeBand[] = [
  { threshold: 6,        color: '#94A3B8', label: 'Silver'     },
  { threshold: 12,       color: '#EAB308', label: 'Yellow'     },
  { threshold: 18,       color: '#60A5FA', label: 'Light Blue' },
  { threshold: 50,       color: '#1D4ED8', label: 'Royal Blue' },
  { threshold: Infinity, color: '#16A34A', label: 'Green'      },
]

function activeBand(value: number, bands: GaugeBand[]): GaugeBand {
  return bands.find(b => value < b.threshold) ?? bands[bands.length - 1]
}

interface GaugeChartProps {
  value: number
  max: number
  bands: GaugeBand[]
  label: string
  formatValue: (v: number) => string
}

export function GaugeChart({ value, bands, max, label, formatValue }: GaugeChartProps) {
  const cx = 100, cy = 108, r = 80, sw = 22
  const pct    = Math.min(Math.max(value / max, 0), 1)
  const band   = activeBand(value, bands)
  const isGoal = value >= max

  // stroke-dasharray segment positioning for a clockwise SVG circle.
  // offset = (1 - startFrac) * half positions each band correctly along the top arc.
  const half = Math.PI * r
  const full = 2 * Math.PI * r

  const segments = bands.map((b, i) => {
    const lo = i === 0 ? 0 : Math.min(bands[i - 1].threshold, max)
    const hi = Math.min(b.threshold, max)
    return { color: b.color, label: b.label, startFrac: lo / max, endFrac: hi / max }
  })

  // Needle: points from center to the arc at the current value's angle
  const θ = Math.PI * (1 - pct)           // π = left (0%), 0 = right (100%)
  const needleLen = r - 4
  const tipX = cx + needleLen * Math.cos(θ)
  const tipY = cy - needleLen * Math.sin(θ)
  const hw = 5                              // half-width of needle base
  const b1x = cx - hw * Math.sin(θ)
  const b1y = cy - hw * Math.cos(θ)
  const b2x = cx + hw * Math.sin(θ)
  const b2y = cy + hw * Math.cos(θ)

  return (
    <div className="flex flex-col items-center">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">{label}</p>
      <svg viewBox="0 0 200 120" className="w-full max-w-[240px]" aria-label={`${label}: ${formatValue(value)}`}>

        {/* Band segments — all zones always visible */}
        {segments.map(seg => (
          <circle
            key={seg.label}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={sw}
            strokeLinecap="butt"
            strokeDasharray={`${(seg.endFrac - seg.startFrac) * half} ${full}`}
            strokeDashoffset={(1 - seg.startFrac) * half}
          />
        ))}

        {/* Thin dividers between bands */}
        {segments.slice(0, -1).map(seg => {
          const dθ = Math.PI * (1 - seg.endFrac)
          const inner = r - sw / 2
          const outer = r + sw / 2
          return (
            <line
              key={`div-${seg.label}`}
              x1={cx + inner * Math.cos(dθ)}
              y1={cy - inner * Math.sin(dθ)}
              x2={cx + outer * Math.cos(dθ)}
              y2={cy - outer * Math.sin(dθ)}
              stroke="white"
              strokeWidth={2}
            />
          )
        })}

        {/* Needle */}
        <polygon
          points={`${b1x},${b1y} ${tipX},${tipY} ${b2x},${b2y}`}
          fill="#1F3864"
        />

        {/* Hub circle */}
        <circle cx={cx} cy={cy} r={10} fill="#1F3864" />
        <circle cx={cx} cy={cy} r={5}  fill="#CBD5E1" />

        {/* Value */}
        <text
          x={cx} y={cy - 28}
          textAnchor="middle"
          style={{ fontSize: 24, fontWeight: 700, fill: '#0F172A', fontFamily: 'inherit' }}
        >
          {formatValue(value)}
        </text>

        {/* Band label */}
        <text
          x={cx} y={cy - 12}
          textAnchor="middle"
          style={{ fontSize: 10, fontWeight: 600, fill: band.color, fontFamily: 'inherit' }}
        >
          {isGoal ? '🎯 Goal!' : band.label}
        </text>
      </svg>

      {/* Scale labels */}
      <div className="flex justify-between w-full max-w-[240px] px-2 -mt-2">
        <span className="text-xs text-slate-400">0</span>
        <span className="text-xs text-slate-400">{formatValue(max)}</span>
      </div>
    </div>
  )
}
