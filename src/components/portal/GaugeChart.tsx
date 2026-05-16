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
  const cx = 100, cy = 108, r = 82, sw = 20
  const pct    = Math.min(Math.max(value / max, 0), 1)
  const band   = activeBand(value, bands)
  const isGoal = value >= max

  // Arc lengths for stroke-dasharray positioning.
  // SVG circle strokes clockwise from (cx+r, cy).
  // offset = half shifts the visible window to the top semicircle (left → top → right).
  // Formula for a segment [startFrac, endFrac] of the gauge:
  //   dasharray : `${(endFrac - startFrac) * half} ${full}`
  //   dashoffset: `${(1 - startFrac) * half}`
  const half = Math.PI * r
  const full = 2 * Math.PI * r

  // Pre-compute each band's start/end as fractions of max (capped at 1)
  const segments = bands.map((b, i) => {
    const lo = i === 0 ? 0 : Math.min(bands[i - 1].threshold, max)
    const hi = Math.min(b.threshold, max)
    return { color: b.color, label: b.label, startFrac: lo / max, endFrac: hi / max }
  })

  return (
    <div className="flex flex-col items-center">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">{label}</p>
      <svg viewBox="0 0 200 128" className="w-full max-w-[220px]" aria-label={`${label}: ${formatValue(value)}`}>

        {/* Background: all band zones at low opacity so thresholds are visible */}
        {segments.map(seg => (
          <circle
            key={`bg-${seg.label}`}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={sw}
            strokeLinecap="butt"
            strokeDasharray={`${(seg.endFrac - seg.startFrac) * half} ${full}`}
            strokeDashoffset={(1 - seg.startFrac) * half}
            opacity={0.25}
          />
        ))}

        {/* Progress: filled band segments at full opacity, up to current value */}
        {segments.map(seg => {
          const filledEnd = Math.min(pct, seg.endFrac)
          if (filledEnd <= seg.startFrac) return null
          return (
            <circle
              key={`fg-${seg.label}`}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={sw}
              strokeLinecap="butt"
              strokeDasharray={`${(filledEnd - seg.startFrac) * half} ${full}`}
              strokeDashoffset={(1 - seg.startFrac) * half}
            />
          )
        })}

        {/* Value */}
        <text
          x={cx} y={cy - 18}
          textAnchor="middle"
          style={{ fontSize: 26, fontWeight: 700, fill: '#0F172A', fontFamily: 'inherit' }}
        >
          {formatValue(value)}
        </text>

        {/* Band label */}
        <text
          x={cx} y={cy + 2}
          textAnchor="middle"
          style={{ fontSize: 11, fill: band.color, fontWeight: 600, fontFamily: 'inherit' }}
        >
          {isGoal ? '🎯 Goal Achieved' : band.label}
        </text>
      </svg>

      {/* Scale labels */}
      <div className="flex justify-between w-full max-w-[220px] px-1 -mt-3">
        <span className="text-xs text-slate-400">0</span>
        <span className="text-xs text-slate-400">{formatValue(max)}</span>
      </div>
    </div>
  )
}
