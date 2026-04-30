import type { ReactNode, ButtonHTMLAttributes } from "react";

/* ============================================================
   Shared UI primitives. Pure presentational, no app logic.
   ============================================================ */

export function Card({
  children,
  className = "",
  padded = true,
}: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <div
      className={`rounded-md border ${padded ? "p-4" : ""} ${className}`}
      style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)" }}
    >
      {children}
    </div>
  );
}

export function Tag({
  children, tone = "neutral",
}: { children: ReactNode; tone?: "neutral" | "brand" | "success" | "warning" | "danger" | "info" }) {
  const tones: Record<string, { bg: string; fg: string; bd: string }> = {
    neutral: { bg: "var(--color-surface-sunken)", fg: "var(--color-text-muted)", bd: "var(--color-border)" },
    brand:   { bg: "var(--color-brand-50)",       fg: "var(--color-brand-700)",  bd: "var(--color-brand-200)" },
    success: { bg: "var(--color-success-50)",     fg: "var(--color-success-700)",bd: "var(--color-success-200)" },
    warning: { bg: "var(--color-warning-50)",     fg: "var(--color-warning-700)",bd: "var(--color-warning-200)" },
    danger:  { bg: "var(--color-danger-50)",      fg: "var(--color-danger-700)", bd: "var(--color-danger-200)" },
    info:    { bg: "var(--color-info-50)",        fg: "var(--color-info-700)",   bd: "var(--color-brand-200)" },
  };
  const t = tones[tone];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border tabular"
      style={{ background: t.bg, color: t.fg, borderColor: t.bd }}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone = "neutral" }: { tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  const colorVar: Record<string, string> = {
    neutral: "var(--color-text-faint)",
    success: "var(--color-success-500)",
    warning: "var(--color-warning-500)",
    danger:  "var(--color-danger-500)",
    info:    "var(--color-info-500)",
  };
  return <span className="h-2 w-2 rounded-full inline-block shrink-0" style={{ background: colorVar[tone] }} />;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  leadingIcon?: ReactNode;
}
export function Button({
  variant = "secondary", size = "md", leadingIcon, className = "", children, ...rest
}: ButtonProps) {
  const sizeCls = size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]";
  const styles: Record<string, React.CSSProperties> = {
    primary:   { background: "var(--color-brand-600)", color: "#fff", borderColor: "var(--color-brand-600)" },
    secondary: { background: "var(--color-surface-raised)", color: "var(--color-text)", borderColor: "var(--color-border-strong)" },
    ghost:     { background: "transparent", color: "var(--color-text-muted)", borderColor: "transparent" },
    danger:    { background: "var(--color-danger-500)", color: "#fff", borderColor: "var(--color-danger-500)" },
  };
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-95 ${sizeCls} ${className}`}
      style={styles[variant]}
    >
      {leadingIcon}
      {children}
    </button>
  );
}

export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-5">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="text-[13px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Metric({
  label, value, delta, tone = "neutral",
}: { label: string; value: ReactNode; delta?: string; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const toneFg: Record<string, string> = {
    neutral: "var(--color-text)",
    success: "var(--color-success-700)",
    warning: "var(--color-warning-700)",
    danger:  "var(--color-danger-700)",
  };
  return (
    <Card>
      <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-faint)" }}>{label}</div>
      <div className="text-[26px] font-semibold leading-none mt-2 tabular" style={{ color: toneFg[tone] }}>{value}</div>
      {delta && <div className="text-[12px] mt-1.5" style={{ color: "var(--color-text-muted)" }}>{delta}</div>}
    </Card>
  );
}

export function LoadingPanel({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <div className="p-8 text-center" style={{ color: "var(--color-text-muted)" }}>{children}</div>
  );
}

export function ErrorPanel({ children }: { children: ReactNode }) {
  return (
    <div
      className="p-4 rounded border text-[13px]"
      style={{ background: "var(--color-danger-50)", color: "var(--color-danger-700)", borderColor: "var(--color-danger-200)" }}
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="p-12 text-center" style={{ color: "var(--color-text-muted)" }}>
      <div className="text-[14px] font-medium" style={{ color: "var(--color-text)" }}>{title}</div>
      {hint && <div className="text-[12.5px] mt-1">{hint}</div>}
    </div>
  );
}
