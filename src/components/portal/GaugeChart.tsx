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
  const pct   = Math.min(Math.max(value / max, 0), 1)
  const band  = activeBand(value, bands)
  const isGoal = value >= max

  // stroke-dasharray technique: circle starts at right (0°) going clockwise.
  // offset = half circumference shifts the visible dash start to the left endpoint,
  // so the arc runs left → up → right (the top semicircle).
  const half = Math.PI * r          // semicircle arc length ≈ 257.6
  const full = 2 * Math.PI * r      // full circumference ≈ 515.2

  return (
    <div className="flex flex-col items-center">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">{label}</p>
      <svg viewBox="0 0 200 128" className="w-full max-w-[220px]" aria-label={`${label}: ${formatValue(value)}`}>

        {/* Background track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={sw}
          strokeLinecap="butt"
          strokeDasharray={`${half} ${half}`}
          strokeDashoffset={half}
        />

        {/* Progress arc */}
        {pct > 0 && (
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={band.color}
            strokeWidth={sw}
            strokeLinecap="butt"
            strokeDasharray={`${pct * half} ${full}`}
            strokeDashoffset={half}
          />
        )}

        {/* End caps at left and right endpoints */}
        <circle cx={cx - r} cy={cy} r={sw / 2} fill="#E2E8F0" />
        <circle cx={cx + r} cy={cy} r={sw / 2} fill="#E2E8F0" />
        {pct > 0 && <circle cx={cx - r} cy={cy} r={sw / 2} fill={band.color} />}

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
