import type { ReactNode } from "react";

/* KPI tile with optional sparkline */
export function Kpi({
  label, value, unit, delta, deltaTone = "neutral", spark, valueTone = "text",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: string;
  deltaTone?: "up" | "down" | "warn" | "neutral";
  spark?: ReactNode;
  valueTone?: "text" | "warning" | "danger" | "success";
}) {
  const valueColor = {
    text: "var(--color-text)",
    warning: "var(--color-warning-700)",
    danger: "var(--color-danger-700)",
    success: "var(--color-success-700)",
  }[valueTone];
  const deltaColor = {
    up: "var(--color-success-700)",
    down: "var(--color-danger-700)",
    warn: "var(--color-warning-700)",
    neutral: "var(--color-text-muted)",
  }[deltaTone];

  return (
    <div
      className="relative overflow-hidden rounded p-4 border"
      style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)" }}
    >
      <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-faint)" }}>{label}</div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="text-[30px] font-semibold leading-none tabular tracking-tight" style={{ color: valueColor }}>{value}</span>
        {unit && <span className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>{unit}</span>}
      </div>
      {delta && <div className="text-[12px] mt-2 tabular" style={{ color: deltaColor }}>{delta}</div>}
      {spark && <div className="absolute right-3.5 top-3.5 opacity-85">{spark}</div>}
    </div>
  );
}

/* Velocity grid (4 cells joined by hairlines) */
export function VelocityGrid({ items }: { items: { label: string; value: ReactNode; sub?: string }[] }) {
  return (
    <div
      className="grid grid-cols-4 gap-px overflow-hidden rounded border"
      style={{ background: "var(--color-border)", borderColor: "var(--color-border)" }}
    >
      {items.map((it, i) => (
        <div key={i} className="p-3.5" style={{ background: "var(--color-surface-raised)" }}>
          <div className="text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-faint)" }}>{it.label}</div>
          <div className="text-[22px] font-semibold mt-1 tabular tracking-tight">{it.value}</div>
          {it.sub && <div className="text-[11px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* Section card */
export function SectionCard({
  title, subtitle, action, children, footer,
}: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div
      className="rounded border overflow-hidden"
      style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)" }}
    >
      <div className="px-4 py-3.5 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--color-border)" }}>
        <div>
          <h3 className="text-[13.5px] font-semibold m-0">{title}</h3>
          {subtitle && <p className="text-[12px] mt-0.5 m-0" style={{ color: "var(--color-text-muted)" }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div>{children}</div>
      {footer && (
        <div className="px-4 py-3 border-t" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-sunken)" }}>
          {footer}
        </div>
      )}
    </div>
  );
}

/* Time range pill */
export function RangePill({
  ranges = ["7d", "30d", "90d", "1y", "All"],
  active = "90d",
  onChange,
}: { ranges?: string[]; active?: string; onChange?: (r: string) => void }) {
  return (
    <div
      className="inline-flex p-0.5 rounded border"
      style={{ background: "var(--color-surface-sunken)", borderColor: "var(--color-border)" }}
    >
      {ranges.map(r => (
        <button
          key={r}
          onClick={() => onChange?.(r)}
          className="px-2.5 py-1 text-[12px] font-medium rounded transition-colors"
          style={{
            background: r === active ? "var(--color-surface-raised)" : "transparent",
            color: r === active ? "var(--color-text)" : "var(--color-text-muted)",
            boxShadow: r === active ? "0 1px 2px rgba(15,27,45,0.08)" : undefined,
            border: 0,
          }}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
