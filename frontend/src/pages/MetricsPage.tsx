import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Tag, Button, LoadingPanel, ErrorPanel } from "../components/ui";
import { SectionCard, RangePill } from "../components/dashboard/kpi";
import { Sparkline, TrendChart, Donut, StackedBar, sectorColor } from "../components/dashboard/charts";
import { fetchDashboardGroup, type DashboardRange } from "../api";

/* ============================================================
   Group-level metrics — sector engagement, trend, reporting health.
   Operational worklist (KPIs + attention + recent activity) lives on
   the Dashboard page so it stays uncluttered.
   ============================================================ */

const KNOWN_RANGES: DashboardRange[] = ["7d", "30d", "90d", "1y", "all"];

export default function MetricsPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<DashboardRange>("90d");

  const groupQ = useQuery({
    queryKey: ["dashboard-group", range],
    queryFn: () => fetchDashboardGroup(range),
  });

  if (groupQ.isLoading) return <LoadingPanel>Loading metrics…</LoadingPanel>;
  if (groupQ.error) return <div className="p-6"><ErrorPanel>Failed to load metrics: {(groupQ.error as Error).message}</ErrorPanel></div>;

  const data = groupQ.data!;
  const sectors = data.sectors;
  const totalForms = sectors.reduce((a, s) => a + s.total, 0);
  const totalPending = sectors.reduce((a, s) => a + s.pending, 0);
  const totalStale = sectors.reduce((a, s) => a + s.stale, 0);
  const totalDownloaded = sectors.reduce((a, s) => a + s.downloaded, 0);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Metrics"
        subtitle={`Engagement, throughput, and reporting health across ${sectors.length} sector${sectors.length === 1 ? "" : "s"}`}
        actions={
          <>
            <RangePill ranges={KNOWN_RANGES as unknown as string[]} active={range} onChange={r => setRange(r as DashboardRange)} />
            <Button size="sm" onClick={() => navigate("/dashboard")}>← Dashboard</Button>
            <Button size="sm" variant="primary" onClick={() => navigate("/dashboard/sectors")}>Compare sectors →</Button>
          </>
        }
      />

      {sectors.length === 0 ? (
        <div className="p-12 text-center" style={{ color: "var(--color-text-muted)" }}>
          No data in this range.
        </div>
      ) : (
        <>
          {/* Row 1: Sector engagement + Reporting health */}
          <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
            <SectionCard
              title="Sector engagement"
              subtitle={`Form volume and reporting status by sector — last ${range}`}
              action={
                <a href="/dashboard/sectors" className="text-[12px] hover:underline" style={{ color: "var(--color-brand-600)" }}>
                  Compare sectors →
                </a>
              }
              footer={
                <div className="flex gap-4 text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
                  <Legend color="var(--color-success-500)" label="Downloaded" />
                  <Legend color="var(--color-warning-500)" label="Pending" />
                  <Legend color="var(--color-danger-500)" label="Stale (mod after dl)" />
                  <span className="ml-auto">{totalForms.toLocaleString()} forms total</span>
                </div>
              }
            >
              <div className="p-2">
                {sectors.map((s, i) => (
                  <div key={s.name}>
                    <button
                      onClick={() => navigate("/dashboard/sectors")}
                      className="w-full text-left grid items-center gap-3.5 px-2.5 py-2.5 rounded hover:bg-[var(--color-surface-sunken)]"
                      style={{ gridTemplateColumns: "150px 1fr 80px 60px" }}
                    >
                      <div>
                        <div className="text-[13px] font-medium" style={{ color: sectorColor(s.name) }}>{s.name}</div>
                        <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
                          {s.active}/{s.sites} active · {s.total > 0 && s.active > 0 ? `${(s.total / s.active).toFixed(1)} forms/site` : "—"}
                        </div>
                      </div>
                      <div>
                        {s.total > 0 ? (
                          <>
                            <StackedBar segments={[
                              { value: s.downloaded, color: "var(--color-success-500)" },
                              { value: s.pending,    color: "var(--color-warning-500)" },
                              { value: s.stale,      color: "var(--color-danger-500)" },
                            ]} />
                            <div className="flex justify-between text-[10.5px] mt-1 tabular" style={{ color: "var(--color-text-faint)", fontFamily: "var(--font-mono)" }}>
                              <span>{s.downloaded} downloaded</span>
                              <span>{s.pending} pending</span>
                              <span>{s.stale} stale</span>
                            </div>
                          </>
                        ) : (
                          <div className="h-[22px] rounded" style={{ background: "var(--color-surface-sunken)" }} />
                        )}
                      </div>
                      <div className="text-[13px] font-semibold text-right tabular" style={{ fontFamily: "var(--font-mono)" }}>{s.total}</div>
                      <div className="flex justify-end">
                        {s.stale > 0 ? <Tag tone="danger">{s.stale}</Tag> : s.pending > 30 ? <Tag tone="warning">{s.pending}</Tag> : s.total > 0 ? <Tag tone="success">✓</Tag> : <Tag tone="neutral">idle</Tag>}
                      </div>
                    </button>
                    {i < sectors.length - 1 && <div className="h-px mx-2" style={{ background: "var(--color-border)" }} />}
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Reporting health" subtitle="Across the whole group, in selected range">
              <div className="p-3.5">
                <div className="grid grid-cols-4 gap-px overflow-hidden rounded border mb-4" style={{ background: "var(--color-border)", borderColor: "var(--color-border)" }}>
                  <Cell label="Coverage"    value={totalForms > 0 ? `${Math.round((totalDownloaded / totalForms) * 100)}%` : "—"} sub="ever downloaded" />
                  <Cell label="Pending"     value={totalPending.toLocaleString()} sub="awaiting download" />
                  <Cell label="Stale"       value={totalStale.toLocaleString()} sub="modified after dl" />
                  <Cell label="Downloaded"  value={totalDownloaded.toLocaleString()} sub="in selected range" />
                </div>
                <div className="flex items-center gap-4">
                  <Donut downloaded={totalDownloaded} pending={totalPending} stale={totalStale} />
                  <div className="flex-1 text-[12px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                    <div className="text-[13px] font-medium mb-1.5" style={{ color: "var(--color-text)" }}>Group health</div>
                    <div>
                      <span className="font-semibold" style={{ color: "var(--color-success-700)" }}>{totalDownloaded.toLocaleString()}</span> downloaded ·{" "}
                      <span className="font-semibold" style={{ color: "var(--color-warning-700)" }}>{totalPending.toLocaleString()}</span> pending ·{" "}
                      <span className="font-semibold" style={{ color: "var(--color-danger-700)" }}>{totalStale.toLocaleString()}</span> stale
                    </div>
                    <div className="text-[11.5px] mt-1" style={{ color: "var(--color-text-faint)" }}>
                      {sectors.reduce((a, s) => a + s.dormant, 0)} dormant · {sectors.reduce((a, s) => a + s.active, 0)} active in range
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Row 2: 12-week trend (full width) */}
          <SectionCard
            title="Forms raised — last 12 weeks"
            subtitle="By sector · spot rising / falling engagement"
          >
            <div className="px-3 pt-2 pb-4">
              <TrendChart series={sectors.map(s => ({ name: s.name, color: sectorColor(s.name), values: s.trend }))} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 text-[11.5px] mt-1" style={{ color: "var(--color-text-muted)" }}>
                {sectors.map(s => <Legend key={s.name} color={sectorColor(s.name)} label={s.name} />)}
              </div>
            </div>
          </SectionCard>

          {/* Row 3: Per-sector recent (sparklines) */}
          <SectionCard title="Forms raised by sector" subtitle="Last 7 weeks · most recent first">
            <div className="p-3.5">
              {sectors.map(s => {
                const recent7 = s.trend.slice(-7);
                const last = recent7[recent7.length - 1] ?? 0;
                return (
                  <div key={s.name} className="grid items-center gap-2.5 mb-1" style={{ gridTemplateColumns: "150px 1fr 50px" }}>
                    <span className="text-[12px] font-medium truncate" title={s.name} style={{ color: sectorColor(s.name) }}>{s.name}</span>
                    <Sparkline values={recent7.length >= 2 ? recent7 : [0, 0]} color={sectorColor(s.name)} width={400} height={28} />
                    <span className="text-[12px] tabular text-right" style={{ fontFamily: "var(--font-mono)" }}>{last}</span>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="inline-block" style={{ width: 10, height: 2, borderRadius: 1, background: color }} />
      {label}
    </span>
  );
}

function Cell({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="p-3.5" style={{ background: "var(--color-surface-raised)" }}>
      <div className="text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-text-faint)" }}>{label}</div>
      <div className="text-[22px] font-semibold mt-1 tabular tracking-tight">{value}</div>
      <div className="text-[11px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>{sub}</div>
    </div>
  );
}
