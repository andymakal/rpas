'use client'

export type GaugeBand = {
  threshold: number  // upper bound (exclusive) for this band
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

function arcPath(cx: number, cy: number, r: number, pct: number): string {
  if (pct <= 0) return ''
  if (pct >= 1) {
    // Full semicircle: two arcs to avoid degenerate case
    return `M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`
  }
  const θ = Math.PI - Math.PI * pct            // from left toward right
  const ex = cx + r * Math.cos(θ)
  const ey = cy - r * Math.sin(θ)
  return `M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${ex} ${ey}`
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
  const pct = Math.min(Math.max(value / max, 0), 1)
  const band = activeBand(value, bands)
  const isGoal = value >= max
  const bg = `M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`
  const fg = arcPath(cx, cy, r, pct)

  return (
    <div className="flex flex-col items-center">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">{label}</p>
      <svg viewBox="0 0 200 128" className="w-full max-w-[220px]" aria-label={`${label}: ${formatValue(value)}`}>
        {/* Background track */}
        <path d={bg} fill="none" stroke="#E2E8F0" strokeWidth={sw} strokeLinecap="butt" />

        {/* Progress arc */}
        {fg && (
          <path d={fg} fill="none" stroke={band.color} strokeWidth={sw} strokeLinecap="butt" />
        )}

        {/* End caps — small circles at start and end of track */}
        <circle cx={cx - r} cy={cy} r={sw / 2} fill="#E2E8F0" />
        <circle cx={cx + r} cy={cy} r={sw / 2} fill="#E2E8F0" />
        {fg && <circle cx={cx - r} cy={cy} r={sw / 2} fill={band.color} />}

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
