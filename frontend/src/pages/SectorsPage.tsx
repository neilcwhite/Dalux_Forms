import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Button, Tag, LoadingPanel, ErrorPanel } from "../components/ui";
import { Kpi, SectionCard, RangePill } from "../components/dashboard/kpi";
import { Sparkline, Donut, StackedBar, sectorColor } from "../components/dashboard/charts";
import {
  fetchDashboardSectors,
  type DashboardRange, type DashboardSectorDetailed,
} from "../api";

const KNOWN_RANGES: DashboardRange[] = ["7d", "30d", "90d", "1y", "all"];

export default function SectorsPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<DashboardRange>("90d");

  const sectorsQ = useQuery({
    queryKey: ["dashboard-sectors", range],
    queryFn: () => fetchDashboardSectors(range),
  });

  if (sectorsQ.isLoading) return <LoadingPanel>Loading sector comparison…</LoadingPanel>;
  if (sectorsQ.error) return <div className="p-6"><ErrorPanel>Failed to load: {(sectorsQ.error as Error).message}</ErrorPanel></div>;

  const sectors = sectorsQ.data!.sectors;
  const ranked = [...sectors].map(s => ({
    ...s,
    formsPerSite: s.total / Math.max(s.active, 1),
  })).sort((a, b) => b.formsPerSite - a.formsPerSite);
  const maxFps = Math.max(...ranked.map(s => s.formsPerSite), 1);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Sector Comparison"
        subtitle={`How is engagement spread across ${sectors.length} active sector${sectors.length === 1 ? "" : "s"}?`}
        actions={
          <>
            <RangePill ranges={KNOWN_RANGES as unknown as string[]} active={range} onChange={r => setRange(r as DashboardRange)} />
            <Button size="sm" onClick={() => navigate("/dashboard")}>← Group</Button>
          </>
        }
      />

      {sectors.length === 0 ? (
        <div className="p-12 text-center" style={{ color: "var(--color-text-muted)" }}>
          No sector data in this range.
        </div>
      ) : (
        <>
          {/* Engagement leaderboard */}
          <SectionCard
            title="Engagement leaderboard"
            subtitle={`Forms per active site, last ${range} — the cleanest measure of sector engagement`}
          >
            <div className="p-4">
              {ranked.map((s, i) => (
                <div key={s.name} className="grid items-center gap-3 py-2.5 border-b last:border-0" style={{ gridTemplateColumns: "32px 220px 1fr 80px 90px", borderColor: "var(--color-border)" }}>
                  <div className="text-[13px] font-semibold tabular text-center" style={{
                    color: i === 0 && ranked.length > 1 ? "var(--color-success-700)"
                         : i === ranked.length - 1 && ranked.length > 1 ? "var(--color-danger-700)"
                         : "var(--color-text-muted)",
                    fontFamily: "var(--font-mono)",
                  }}>
                    {i + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: sectorColor(s.name) }} />
                      <span className="text-[14px] font-semibold">{s.name}</span>
                    </div>
                    <div className="text-[11.5px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                      {s.active}/{s.sites} active · {s.total} forms total
                    </div>
                  </div>
                  <div className="h-3 rounded relative overflow-hidden" style={{ background: "var(--color-surface-sunken)" }}>
                    <div style={{ width: `${(s.formsPerSite / maxFps) * 100}%`, height: "100%", background: sectorColor(s.name) }} />
                  </div>
                  <div className="text-right">
                    <div className="text-[18px] font-semibold tabular" style={{ fontFamily: "var(--font-mono)" }}>{s.formsPerSite.toFixed(1)}</div>
                    <div className="text-[10px]" style={{ color: "var(--color-text-faint)" }}>forms/site</div>
                  </div>
                  <div className="flex justify-end">
                    {ranked.length > 1 && i === 0 ? <Tag tone="success">Leader</Tag>
                     : ranked.length > 1 && i === ranked.length - 1 ? <Tag tone="danger">Trailing</Tag>
                     : <Tag>Mid</Tag>}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Sector cards */}
          <div className="grid grid-cols-3 gap-3 mt-3">
            {sectors.map(s => (
              <div
                key={s.name}
                className="rounded border overflow-hidden"
                style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)", borderTop: `3px solid ${sectorColor(s.name)}` }}
              >
                <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-[15px] font-semibold m-0">{s.name}</h3>
                    <Tag tone={s.dormant > 0 ? "warning" : "success"}>
                      {s.active}/{s.sites} active
                    </Tag>
                  </div>
                  <p className="text-[11.5px] mt-0.5 m-0" style={{ color: "var(--color-text-muted)" }}>
                    {s.dormant > 0 ? `${s.dormant} dormant · ` : ""}{s.total} forms ({range})
                  </p>
                </div>

                <div className="p-4 grid grid-cols-2 gap-3">
                  <Kpi label="Total forms" value={s.total} delta={s.active > 0 ? `${(s.total / s.active).toFixed(1)}/site` : "no active sites"} deltaTone="neutral" />
                  <Kpi label="Stale" value={s.stale} valueTone={s.stale > 5 ? "danger" : "text"} delta={s.total > 0 ? `${Math.round((s.stale / s.total) * 100)}% of total` : "—"} deltaTone={s.stale > 5 ? "down" : "neutral"} />
                </div>

                <div className="px-4 pb-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>Reporting status</div>
                  {s.total > 0 ? (
                    <>
                      <StackedBar segments={[
                        { value: s.downloaded, color: "var(--color-success-500)" },
                        { value: s.pending,    color: "var(--color-warning-500)" },
                        { value: s.stale,      color: "var(--color-danger-500)" },
                      ]} />
                      <div className="flex justify-between text-[10.5px] mt-1.5 tabular" style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                        <span style={{ color: "var(--color-success-700)" }}>{s.downloaded} dl</span>
                        <span style={{ color: "var(--color-warning-700)" }}>{s.pending} pending</span>
                        <span style={{ color: "var(--color-danger-700)" }}>{s.stale} stale</span>
                      </div>
                    </>
                  ) : (
                    <div className="h-[22px] rounded" style={{ background: "var(--color-surface-sunken)" }} />
                  )}
                </div>

                <div className="px-4 pb-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>12-week trend</div>
                  {s.trend.some(v => v > 0) ? (
                    <Sparkline values={s.trend} color={sectorColor(s.name)} width={300} height={50} />
                  ) : (
                    <div className="h-[50px] grid place-items-center text-[11px]" style={{ color: "var(--color-text-faint)" }}>no activity yet</div>
                  )}
                </div>

                {s.top_project && (
                  <div className="px-4 pb-4 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
                    <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-faint)" }}>Top contributing site</div>
                    <button
                      onClick={() => {
                        const sos = s.top_project!.split(" ")[0]; // "C2118 · ..." → "C2118"
                        if (sos) navigate(`/sites/${sos}`);
                      }}
                      className="text-left w-full"
                    >
                      <div className="text-[12.5px] font-medium hover:underline" style={{ color: "var(--color-brand-700)" }}>{s.top_project}</div>
                      <div className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                        {s.top_project_forms} forms{s.total > 0 ? ` · ${Math.round((s.top_project_forms / s.total) * 100)}% of sector` : ""}
                      </div>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Head-to-head matrix */}
          <SectionCard
            title="Head-to-head"
            subtitle="Same metrics across sectors — best in green, worst in red"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ background: "var(--color-surface-sunken)" }}>
                    <th className="px-4 py-2.5 text-left font-semibold text-[11px] uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>Metric</th>
                    {sectors.map(s => (
                      <th key={s.name} className="px-4 py-2.5 text-right font-semibold text-[11px] uppercase tracking-wider" style={{ color: sectorColor(s.name) }}>{s.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Row label="Active sites"                values={sectors.map(s => s.active)} format={v => `${v}`} />
                  <Row label="Total forms"                 values={sectors.map(s => s.total)} format={v => v.toLocaleString()} />
                  <Row label="Forms / active site"         values={sectors.map(s => s.total / Math.max(s.active, 1))} format={v => v.toFixed(1)} />
                  <Row label="Coverage %"                  values={sectors.map(s => s.coverage)} format={v => `${v}%`} />
                  <Row label="Pending"                     values={sectors.map(s => s.pending)} format={v => `${v}`} lowerIsBetter />
                  <Row label="Stale"                       values={sectors.map(s => s.stale)} format={v => `${v}`} lowerIsBetter />
                  <Row label="Open → Closed (days)"        values={sectors.map(s => s.open_to_closed_days)} format={fmtDays} lowerIsBetter />
                  <Row label="Closed → Downloaded (days)"  values={sectors.map(s => s.closed_to_dl_days)} format={fmtDays} lowerIsBetter />
                  <Row label="Dormant sites"               values={sectors.map(s => s.dormant)} format={v => `${v}`} lowerIsBetter />
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* Top templates per sector */}
          <SectionCard
            title="Top templates by sector"
            subtitle="What forms each sector raises most — useful for prioritising template work"
          >
            <div className="grid gap-px" style={{ background: "var(--color-border)", gridTemplateColumns: `repeat(${Math.min(sectors.length, 3)}, minmax(0, 1fr))` }}>
              {sectors.map(s => (
                <div key={s.name} className="p-4" style={{ background: "var(--color-surface-raised)" }}>
                  <div className="text-[13px] font-semibold mb-3" style={{ color: sectorColor(s.name) }}>{s.name}</div>
                  {s.top_templates.length === 0 ? (
                    <div className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>No forms in range.</div>
                  ) : s.top_templates.slice(0, 5).map(t => (
                    <MixRow key={t.name} label={t.name} value={t.count} total={s.total} color={sectorColor(s.name)} />
                  ))}
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Health snapshot */}
          <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: `repeat(${Math.min(sectors.length, 3)}, minmax(0, 1fr))` }}>
            {sectors.map(s => (
              <div key={s.name} className="rounded border p-4 flex items-center gap-4" style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)" }}>
                <Donut downloaded={s.downloaded} pending={s.pending} stale={s.stale} size={64} />
                <div>
                  <div className="text-[12.5px] font-semibold" style={{ color: sectorColor(s.name) }}>{s.name}</div>
                  <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>{s.coverage}% coverage</div>
                  <div className="text-[11px] mt-1" style={{ color: "var(--color-text-faint)" }}>
                    {fmtDays(s.open_to_closed_days)}d open→closed · {fmtDays(s.closed_to_dl_days)}d to dl
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* helpers */

function fmtDays(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return v.toFixed(1);
}

function Row({
  label, values, format, lowerIsBetter,
}: {
  label: string;
  values: (number | null)[];
  format: (v: any) => string;
  lowerIsBetter?: boolean;
}) {
  // Determine best/worst ignoring nulls
  const numericValues = values.filter((v): v is number => typeof v === "number");
  const best = numericValues.length > 0 ? (lowerIsBetter ? Math.min(...numericValues) : Math.max(...numericValues)) : null;
  const worst = numericValues.length > 0 ? (lowerIsBetter ? Math.max(...numericValues) : Math.min(...numericValues)) : null;

  return (
    <tr className="border-t" style={{ borderColor: "var(--color-border)" }}>
      <td className="px-4 py-2.5 font-medium" style={{ color: "var(--color-text-muted)" }}>{label}</td>
      {values.map((v, i) => {
        const isNum = typeof v === "number";
        const isBest = isNum && v === best && best !== worst;
        const isWorst = isNum && v === worst && best !== worst;
        return (
          <td key={i} className="px-4 py-2.5 text-right tabular" style={{ fontFamily: "var(--font-mono)" }}>
            <span
              className="inline-block px-2 py-0.5 rounded font-semibold"
              style={{
                background: isBest ? "var(--color-success-50)" : isWorst ? "var(--color-danger-50)" : "transparent",
                color: isBest ? "var(--color-success-700)" : isWorst ? "var(--color-danger-700)" : "var(--color-text)",
              }}
            >
              {format(v)}
            </span>
          </td>
        );
      })}
    </tr>
  );
}

function MixRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="grid items-center gap-2 mb-2" style={{ gridTemplateColumns: "150px 1fr 60px" }}>
      <span className="text-[11.5px] truncate" title={label} style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <div className="h-2 rounded overflow-hidden" style={{ background: "var(--color-surface-sunken)" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <span className="text-[11.5px] tabular text-right" style={{ fontFamily: "var(--font-mono)" }}>{value} <span style={{ color: "var(--color-text-faint)" }}>({Math.round(pct)}%)</span></span>
    </div>
  );
}

// Suppress unused-import warning for DashboardSectorDetailed (kept for type
// re-export reference).
export type { DashboardSectorDetailed };
