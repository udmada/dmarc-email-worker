interface DonutChartProps {
  value: number; // 0–100
  label: string;
  sublabel?: string;
  color: string;
  size?: number;
  strokeWidth?: number;
}

export function DonutChart({
  value,
  label,
  sublabel,
  color,
  size = 128,
  strokeWidth = 11,
}: DonutChartProps): React.ReactElement {
  const clamped = Math.min(100, Math.max(0, value));
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-label={`${label}: ${clamped}%`}>
        {/* track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--color-kumo-fill)"
          strokeWidth={strokeWidth}
        />
        {/* filled arc */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        {/* percentage */}
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--text-color-kumo-default)"
          fontSize="20"
          fontWeight="700"
          fontFamily="inherit">
          {clamped}%
        </text>
      </svg>
      <p className="text-sm font-medium text-kumo-default text-center leading-tight">{label}</p>
      {sublabel != null && (
        <p className="text-xs text-kumo-inactive text-center leading-tight">{sublabel}</p>
      )}
    </div>
  );
}
