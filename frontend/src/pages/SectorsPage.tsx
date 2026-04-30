import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, Button, Tag } from "../components/ui";
import { Kpi, SectionCard, RangePill } from "../components/dashboard/kpi";
import { Sparkline, Donut, StackedBar, sectorColor } from "../components/dashboard/charts";

/* ============================================================
   Sector comparison
   TODO: replace mock data with /api/dashboard/sectors?range=...
   ============================================================ */

// MOCK DATA START -----------------------------------------------
type Sector = {
  name: string;
  sites: number; active: number; dormant: number;
  total: number; downloaded: number; pending: number; stale: number;
  trend: number[];
  ra: number; mwi: number; ptw: number; insp: number;
  openToClosed: number; closedToDl: number; coverage: number;
  topProject: string; topProjectForms: number;
};
const MOCK_SECTORS: Sector[] = [
  { name: "Rail",              sites: 11, active: 10, dormant: 1, total: 412, downloaded: 372, pending: 32, stale:  8, trend: [28,31,34,30,38,42,39,44,41,48,52,49], ra: 142, mwi: 88, ptw: 96, insp: 86, openToClosed: 6.2, closedToDl: 2.1, coverage: 90, topProject: "SOS-2204 · Crewe Hub Phase 2",          topProjectForms: 64 },
  { name: "Building & Civils", sites: 14, active: 11, dormant: 3, total: 287, downloaded: 198, pending: 64, stale: 25, trend: [12,18,14,22,28,19,32,26,34,38,31,42], ra:  86, mwi: 64, ptw: 78, insp: 59, openToClosed: 9.1, closedToDl: 3.4, coverage: 69, topProject: "SOS-2118 · A14 Cambridge–Huntingdon",   topProjectForms: 47 },
  { name: "Bridges",           sites:  5, active:  3, dormant: 2, total:  64, downloaded:  41, pending: 19, stale:  4, trend: [4,6,3,5,8,6,4,7,5,9,6,8],            ra:  18, mwi: 14, ptw: 22, insp: 10, openToClosed: 12.4, closedToDl: 5.2, coverage: 64, topProject: "SOS-2412 · M1 J16 Bridge Replacement",  topProjectForms: 28 },
];
// MOCK DATA END -------------------------------------------------

export default function SectorsPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState("90d");
  const sectors = MOCK_SECTORS;

  const ranked = [...sectors].map(s => ({
    ...s,
    formsPerSite: s.total / Math.max(s.active, 1),
  })).sort((a, b) => b.formsPerSite - a.formsPerSite);
  const maxFps = Math.max(...ranked.map(s => s.formsPerSite));

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Sector Comparison"
        subtitle="How is engagement spread across Rail, Building & Civils, and Bridges?"
        actions={
          <>
            <RangePill active={range} onChange={setRange} />
            <Button size="sm" onClick={() => navigate("/dashboard")}>← Group</Button>
            <Button size="sm" variant="primary">Export comparison</Button>
          </>
        }
      />

      {/* Engagement leaderboard */}
      <SectionCard
        title="Engagement leaderboard"
        subtitle="Forms per active site, last 90 days — the cleanest measure of sector engagement"
      >
        <div className="p-4">
          {ranked.map((s, i) => (
            <div key={s.name} className="grid items-center gap-3 py-2.5 border-b last:border-0" style={{ gridTemplateColumns: "32px 220px 1fr 80px 90px", borderColor: "var(--color-border)" }}>
              <div className="text-[13px] font-semibold tabular text-center" style={{
                color: i === 0 ? "var(--color-success-700)" : i === ranked.length - 1 ? "var(--color-danger-700)" : "var(--color-text-muted)",
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
                {i === 0 ? <Tag tone="success">Leader</Tag> : i === ranked.length - 1 ? <Tag tone="danger">Trailing</Tag> : <Tag>Mid</Tag>}
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
                {s.dormant > 0 ? `${s.dormant} dormant · ` : ""}{s.total} forms (last 90d)
              </p>
            </div>

            <div className="p-4 grid grid-cols-2 gap-3">
              <Kpi label="Total forms" value={s.total} delta={`${(s.total / Math.max(s.active, 1)).toFixed(1)}/site`} deltaTone="neutral" />
              <Kpi label="Stale" value={s.stale} valueTone={s.stale > 5 ? "danger" : "text"} delta={`${Math.round((s.stale / s.total) * 100)}% of total`} deltaTone={s.stale > 5 ? "down" : "neutral"} />
            </div>

            <div className="px-4 pb-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>Reporting status</div>
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
            </div>

            <div className="px-4 pb-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-faint)" }}>12-week trend</div>
              <Sparkline values={s.trend} color={sectorColor(s.name)} width={300} height={50} />
            </div>

            <div className="px-4 pb-4 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--color-text-faint)" }}>Top contributing site</div>
              <button onClick={() => navigate(`/sites/${s.topProject.split(" ")[0]}`)} className="text-left w-full">
                <div className="text-[12.5px] font-medium hover:underline" style={{ color: "var(--color-brand-700)" }}>{s.topProject}</div>
                <div className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>{s.topProjectForms} forms · {Math.round((s.topProjectForms / s.total) * 100)}% of sector</div>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Head-to-head matrix */}
      <SectionCard
        title="Head-to-head"
        subtitle="Same metrics across sectors — best in green, worst in red"
        action={<a className="text-[12px]" style={{ color: "var(--color-brand-600)" }}>Export →</a>}
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
              <Row label="Active sites"          values={sectors.map(s => s.active)} format={v => `${v}`} />
              <Row label="Total forms"           values={sectors.map(s => s.total)} format={v => v.toLocaleString()} />
              <Row label="Forms / active site"   values={sectors.map(s => s.total / Math.max(s.active, 1))} format={v => v.toFixed(1)} />
              <Row label="Coverage %"            values={sectors.map(s => s.coverage)} format={v => `${v}%`} suffix="" />
              <Row label="Pending"               values={sectors.map(s => s.pending)} format={v => `${v}`} lowerIsBetter />
              <Row label="Stale"                 values={sectors.map(s => s.stale)} format={v => `${v}`} lowerIsBetter />
              <Row label="Open → Closed (days)"  values={sectors.map(s => s.openToClosed)} format={v => v.toFixed(1)} lowerIsBetter />
              <Row label="Closed → Downloaded (days)" values={sectors.map(s => s.closedToDl)} format={v => v.toFixed(1)} lowerIsBetter />
              <Row label="Dormant sites"         values={sectors.map(s => s.dormant)} format={v => `${v}`} lowerIsBetter />
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Form mix */}
      <SectionCard
        title="Form mix by sector"
        subtitle="Different sectors use different templates — useful for prioritising template work"
      >
        <div className="grid grid-cols-3 gap-px" style={{ background: "var(--color-border)" }}>
          {sectors.map(s => {
            const total = s.ra + s.mwi + s.ptw + s.insp;
            return (
              <div key={s.name} className="p-4" style={{ background: "var(--color-surface-raised)" }}>
                <div className="text-[13px] font-semibold mb-3" style={{ color: sectorColor(s.name) }}>{s.name}</div>
                <MixRow label="Risk Assessment"   value={s.ra}   total={total} color={sectorColor(s.name)} />
                <MixRow label="Method Statement"  value={s.mwi}  total={total} color={sectorColor(s.name)} />
                <MixRow label="Permit to Work"    value={s.ptw}  total={total} color={sectorColor(s.name)} />
                <MixRow label="Inspection"        value={s.insp} total={total} color={sectorColor(s.name)} />
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Health snapshot */}
      <div className="grid grid-cols-3 gap-3 mt-3">
        {sectors.map(s => (
          <div key={s.name} className="rounded border p-4 flex items-center gap-4" style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)" }}>
            <Donut downloaded={s.downloaded} pending={s.pending} stale={s.stale} size={64} />
            <div>
              <div className="text-[12.5px] font-semibold" style={{ color: sectorColor(s.name) }}>{s.name}</div>
              <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>{s.coverage}% coverage</div>
              <div className="text-[11px] mt-1" style={{ color: "var(--color-text-faint)" }}>
                {s.openToClosed.toFixed(1)}d open→closed · {s.closedToDl.toFixed(1)}d to download
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* helpers */
function Row({ label, values, format, lowerIsBetter, suffix = "" }: {
  label: string; values: number[]; format: (v: number) => string; lowerIsBetter?: boolean; suffix?: string;
}) {
  const best = lowerIsBetter ? Math.min(...values) : Math.max(...values);
  const worst = lowerIsBetter ? Math.max(...values) : Math.min(...values);
  return (
    <tr className="border-t" style={{ borderColor: "var(--color-border)" }}>
      <td className="px-4 py-2.5 font-medium" style={{ color: "var(--color-text-muted)" }}>{label}</td>
      {values.map((v, i) => {
        const isBest = v === best && best !== worst;
        const isWorst = v === worst && best !== worst;
        return (
          <td key={i} className="px-4 py-2.5 text-right tabular" style={{ fontFamily: "var(--font-mono)" }}>
            <span
              className="inline-block px-2 py-0.5 rounded font-semibold"
              style={{
                background: isBest ? "var(--color-success-50)" : isWorst ? "var(--color-danger-50)" : "transparent",
                color: isBest ? "var(--color-success-700)" : isWorst ? "var(--color-danger-700)" : "var(--color-text)",
              }}
            >
              {format(v)}{suffix}
            </span>
          </td>
        );
      })}
    </tr>
  );
}

function MixRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = (value / total) * 100;
  return (
    <div className="grid items-center gap-2 mb-2" style={{ gridTemplateColumns: "120px 1fr 50px" }}>
      <span className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <div className="h-2 rounded overflow-hidden" style={{ background: "var(--color-surface-sunken)" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <span className="text-[11.5px] tabular text-right" style={{ fontFamily: "var(--font-mono)" }}>{value} <span style={{ color: "var(--color-text-faint)" }}>({Math.round(pct)}%)</span></span>
    </div>
  );
}
