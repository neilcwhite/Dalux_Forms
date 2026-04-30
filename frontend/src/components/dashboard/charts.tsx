/* ============================================================
   Pure-SVG chart primitives. No deps. Themed via CSS vars so
   they follow light/dark mode automatically.
   ============================================================ */

export const SECTOR_COLORS: Record<string, string> = {
  "Rail":              "#1B7A4D",
  "Building & Civils": "#233E99",
  "Bridges":           "#B86A00",
};

export function sectorColor(name: string): string {
  return SECTOR_COLORS[name] ?? "var(--color-text-muted)";
}

/* -------------------- Sparkline -------------------- */
export function Sparkline({
  values, color = "var(--color-brand-600)", width = 80, height = 28, fill = true,
}: { values: number[]; color?: string; width?: number; height?: number; fill?: boolean }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pad = 2;
  const xs = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const ys = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"} ${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(" ");
  const area = `${d} L ${xs(values.length - 1).toFixed(1)} ${height - pad} L ${pad} ${height - pad} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }} width={width} height={height}>
      {fill && <path d={area} fill={color} opacity={0.15} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------- Multi-line trend -------------------- */
export function TrendChart({
  series, height = 200, weeks = 12,
}: { series: { name: string; color: string; values: number[] }[]; height?: number; weeks?: number }) {
  const width = 720;
  const padL = 36, padR = 16, padT = 14, padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const maxVal = Math.max(...series.flatMap(s => s.values), 1);
  const yTicks = 4;
  const xs = (i: number) => padL + (i / (weeks - 1)) * innerW;
  const ys = (v: number) => padT + innerH - (v / maxVal) * innerH;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }}>
      {/* gridlines */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = (maxVal / yTicks) * (yTicks - i);
        const y = padT + (i / yTicks) * innerH;
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="var(--color-border)" strokeWidth={1} />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--color-text-faint)" style={{ fontFamily: "var(--font-mono)" }}>
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      {/* x labels */}
      {Array.from({ length: weeks }, (_, i) =>
        i % 2 === 0 ? (
          <text key={i} x={xs(i)} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--color-text-faint)" style={{ fontFamily: "var(--font-mono)" }}>
            W{i + 1}
          </text>
        ) : null,
      )}
      {/* lines */}
      {series.map((s, si) => {
        const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(" ");
        return (
          <g key={si}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {s.values.map((v, i) => (
              <circle key={i} cx={xs(i)} cy={ys(v)} r={2.5} fill={s.color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/* -------------------- Daily bar chart -------------------- */
export function BarChart({
  values, height = 200,
  labels = ["30d ago", "23d", "16d", "9d", "Today"],
}: { values: number[]; height?: number; labels?: string[] }) {
  const width = 720;
  const padL = 28, padR = 14, padT = 14, padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(...values, 5);
  const barW = innerW / values.length - 2;
  const yTicks = 4;
  const labelIndices = [0, 7, 14, 21, values.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height, padding: 14, boxSizing: "border-box" }}>
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = (max / yTicks) * (yTicks - i);
        const y = padT + (i / yTicks) * innerH;
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="var(--color-border)" strokeWidth={1} />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--color-text-faint)" style={{ fontFamily: "var(--font-mono)" }}>
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      {values.map((v, i) => {
        const x = padL + i * (innerW / values.length) + 1;
        const bh = (v / max) * innerH;
        const y = padT + innerH - bh;
        return <rect key={i} x={x} y={y} width={barW} height={bh} fill="var(--color-brand-600)" rx={1.5} />;
      })}
      {labelIndices.map((i, idx) => {
        if (i >= values.length) return null;
        const x = padL + i * (innerW / values.length) + barW / 2;
        return (
          <text key={i} x={x} y={height - 6} textAnchor="middle" fontSize="9.5" fill="var(--color-text-faint)" style={{ fontFamily: "var(--font-mono)" }}>
            {labels[idx]}
          </text>
        );
      })}
    </svg>
  );
}

/* -------------------- Donut (3-segment) -------------------- */
export function Donut({
  downloaded, pending, stale, size = 80,
}: { downloaded: number; pending: number; stale: number; size?: number }) {
  const total = downloaded + pending + stale || 1;
  const dPct = (downloaded / total) * 100;
  const pPct = (pending / total) * 100;
  const a = dPct, b = a + pPct;
  const bg = `conic-gradient(var(--color-success-500) 0 ${a}%, var(--color-warning-500) ${a}% ${b}%, var(--color-danger-500) ${b}% 100%)`;
  const inset = size * 0.16;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size, borderRadius: "50%", background: bg }}>
      <div className="absolute" style={{ inset, background: "var(--color-surface-raised)", borderRadius: "50%" }} />
      <div className="absolute inset-0 grid place-items-center text-[16px] font-semibold tabular z-10">
        {Math.round(dPct)}%
      </div>
    </div>
  );
}

/* -------------------- Stacked horizontal bar -------------------- */
export function StackedBar({
  segments, height = 22,
}: { segments: { value: number; color: string }[]; height?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div className="relative w-full overflow-hidden" style={{ height, background: "var(--color-surface-sunken)", borderRadius: 3 }}>
      <div className="flex h-full">
        {segments.map((s, i) => (
          <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color, height: "100%" }} />
        ))}
      </div>
    </div>
  );
}
