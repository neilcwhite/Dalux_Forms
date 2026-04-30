import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, Button, Tag } from "../components/ui";
import { Kpi, VelocityGrid, SectionCard, RangePill } from "../components/dashboard/kpi";
import { Sparkline, TrendChart, Donut, StackedBar, sectorColor } from "../components/dashboard/charts";

/* ============================================================
   Group dashboard
   TODO: replace mock data with /api/dashboard/group?range=...
   ============================================================ */

// MOCK DATA START -----------------------------------------------
type Sector = {
  name: string;
  sites: number; active: number; dormant: number;
  total: number; downloaded: number; pending: number; stale: number;
  trend: number[];
};
const MOCK_SECTORS: Sector[] = [
  { name: "Building & Civils", sites: 14, active: 11, dormant: 3, total: 287, downloaded: 198, pending: 64, stale: 25, trend: [12,18,14,22,28,19,32,26,34,38,31,42] },
  { name: "Rail",              sites: 11, active: 10, dormant: 1, total: 412, downloaded: 372, pending: 32, stale:  8, trend: [28,31,34,30,38,42,39,44,41,48,52,49] },
  { name: "Bridges",           sites:  5, active:  3, dormant: 2, total:  64, downloaded:  41, pending: 19, stale:  4, trend: [4,6,3,5,8,6,4,7,5,9,6,8] },
];

const MOCK_FEED = [
  { kind: "ok",   icon: "✓", time: "12m ago",  text: "Jess M. downloaded 14 forms from SOS-2401 · A14 Cambridge" },
  { kind: "warn", icon: "⚠", time: "1h ago",   text: "3 forms went stale on SOS-2204 · Crewe Hub (modified after last download)" },
  { kind: "info", icon: "+", time: "2h ago",   text: "Site Engineer raised 4 RA forms on SOS-2412 · M1 J16 Bridge" },
  { kind: "info", icon: "+", time: "3h ago",   text: "14 forms raised on Rail sites today (4 sites active)" },
  { kind: "err",  icon: "!", time: "5h ago",   text: "SOS-2108 · Selby Marshalling has been dormant for 62 days" },
  { kind: "info", icon: "+", time: "8h ago",   text: "James K. added a new template: PTW v3 (Bridges)" },
  { kind: "ok",   icon: "✓", time: "Yesterday", text: "Bulk download · 42 reports generated for monthly client pack" },
];

const MOCK_ATTENTION = [
  { sos: "SOS-2204", name: "Crewe Hub Phase 2",            sector: "Rail",              total: 64, pending: 18, stale: 7, pct: 72 },
  { sos: "SOS-2118", name: "A14 Cambridge to Huntingdon",  sector: "Building & Civils", total: 47, pending: 22, stale: 9, pct: 53 },
  { sos: "SOS-2412", name: "M1 J16 Bridge Replacement",    sector: "Bridges",           total: 28, pending: 14, stale: 3, pct: 50 },
  { sos: "SOS-2306", name: "Doncaster IPort Sidings",      sector: "Rail",              total: 39, pending: 11, stale: 4, pct: 72 },
  { sos: "SOS-2227", name: "Felixstowe South",             sector: "Building & Civils", total: 22, pending:  8, stale: 5, pct: 64 },
  { sos: "SOS-2415", name: "A1 Newcastle Viaduct",         sector: "Bridges",           total: 18, pending:  6, stale: 1, pct: 67 },
];
// MOCK DATA END -------------------------------------------------

export default function DashboardPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState("90d");
  const sectors = MOCK_SECTORS;

  const totalSites = sectors.reduce((a, s) => a + s.sites, 0);
  const activeSites = sectors.reduce((a, s) => a + s.active, 0);
  const dormantSites = sectors.reduce((a, s) => a + s.dormant, 0);
  const totalForms = sectors.reduce((a, s) => a + s.total, 0);
  const totalPending = sectors.reduce((a, s) => a + s.pending, 0);
  const totalStale = sectors.reduce((a, s) => a + s.stale, 0);
  const totalDownloaded = sectors.reduce((a, s) => a + s.downloaded, 0);
  const lastWeek = sectors.reduce((a, s) => a + s.trend[s.trend.length - 1], 0);
  const prevWeek = sectors.reduce((a, s) => a + s.trend[s.trend.length - 2], 0);
  const weekDelta = lastWeek - prevWeek;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Group Dashboard"
        subtitle={`${activeSites} active sites across ${sectors.length} sectors · ${totalForms.toLocaleString()} total forms`}
        actions={
          <>
            <RangePill active={range} onChange={setRange} />
            <Button size="sm">Export</Button>
            <Button size="sm" variant="primary" onClick={() => navigate("/dashboard/sectors")}>
              Compare sectors →
            </Button>
          </>
        }
      />

      {dormantSites > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded mb-3 border"
          style={{
            background: "var(--color-warning-50)",
            borderColor: "var(--color-warning-500)",
            borderLeftWidth: 3,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning-700)" strokeWidth="2">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" x2="12" y1="9" y2="13" />
            <line x1="12" x2="12.01" y1="17" y2="17" />
          </svg>
          <div className="text-[12.5px] flex-1">
            <strong style={{ color: "var(--color-warning-700)" }}>{dormantSites} sites have been dormant for 30+ days</strong>
            {" "}— no forms raised, no Dalux activity.{" "}
            <a href="/sites" className="underline" style={{ color: "var(--color-brand-600)" }}>Review dormant sites →</a>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3 mb-4">
        <Kpi
          label="Active sites · 30d"
          value={activeSites}
          unit={`/ ${totalSites}`}
          delta="↑ 2 vs last month"
          deltaTone="up"
          spark={<Sparkline values={[18,19,20,21,21,22,22,23,23,24,24,activeSites]} color="var(--color-success-500)" />}
        />
        <Kpi
          label="Forms this week"
          value={lastWeek}
          delta={`${weekDelta >= 0 ? "↑" : "↓"} ${Math.abs(weekDelta)} vs last week`}
          deltaTone={weekDelta >= 0 ? "up" : "down"}
          spark={<Sparkline values={sectors[0].trend.map((_, i) => sectors.reduce((a, s) => a + s.trend[i], 0))} color="var(--color-brand-600)" />}
        />
        <Kpi
          label="Pending downloads"
          value={totalPending}
          valueTone="warning"
          delta={`${Math.round((totalPending / totalForms) * 100)}% of all forms`}
          deltaTone="warn"
          spark={<Sparkline values={[88,92,98,104,110,108,112,116,118,120,118,totalPending]} color="var(--color-warning-500)" />}
        />
        <Kpi
          label="Stale"
          value={totalStale}
          valueTone="danger"
          delta="↑ 4 since yesterday"
          deltaTone="down"
          spark={<Sparkline values={[18,21,24,28,30,32,33,34,35,36,36,totalStale]} color="var(--color-danger-500)" />}
        />
      </div>

      {/* Sector engagement + Reporting velocity */}
      <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
        <SectionCard
          title="Sector engagement"
          subtitle="Form volume and reporting status by sector — click to drill in"
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
              <span className="ml-auto">Total {totalForms.toLocaleString()} forms</span>
            </div>
          }
        >
          <div className="p-2">
            {sectors.map((s, i) => (
              <div key={s.name}>
                <button
                  onClick={() => navigate("/dashboard/sectors")}
                  className="w-full text-left grid items-center gap-3.5 px-2.5 py-2.5 rounded hover:bg-[var(--color-surface-sunken)]"
                  style={{ gridTemplateColumns: "130px 1fr 76px 60px" }}
                >
                  <div>
                    <div className="text-[13px] font-medium" style={{ color: sectorColor(s.name) }}>{s.name}</div>
                    <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
                      {s.active}/{s.sites} active · {(s.total / Math.max(s.active, 1)).toFixed(1)} forms/site
                    </div>
                  </div>
                  <div>
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
                  </div>
                  <div className="text-[13px] font-semibold text-right tabular" style={{ fontFamily: "var(--font-mono)" }}>{s.total}</div>
                  <div className="flex justify-end">
                    {s.stale > 5 ? <Tag tone="danger">{s.stale}</Tag> : s.pending > 30 ? <Tag tone="warning">{s.pending}</Tag> : <Tag tone="success">✓</Tag>}
                  </div>
                </button>
                {i < sectors.length - 1 && <div className="h-px mx-2" style={{ background: "var(--color-border)" }} />}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Reporting velocity" subtitle="How fast forms move through the pipeline">
          <div className="p-3.5">
            <VelocityGrid items={[
              { label: "Open → Closed",       value: <>8.4<small className="text-[14px] font-normal" style={{ color: "var(--color-text-muted)" }}>d</small></>, sub: "avg, last 90d" },
              { label: "Closed → Downloaded", value: <>3.1<small className="text-[14px] font-normal" style={{ color: "var(--color-text-muted)" }}>d</small></>, sub: "avg, last 90d" },
              { label: "Open → Downloaded",   value: <>11.5<small className="text-[14px] font-normal" style={{ color: "var(--color-text-muted)" }}>d</small></>, sub: "end-to-end median" },
              { label: "Coverage",            value: `${Math.round((totalDownloaded / totalForms) * 100)}%`, sub: "ever downloaded" },
            ]} />
            <div className="flex items-center gap-4 mt-4">
              <Donut downloaded={totalDownloaded} pending={totalPending} stale={totalStale} />
              <div className="flex-1 text-[12px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                <div className="text-[13px] font-medium mb-1.5" style={{ color: "var(--color-text)" }}>Group health</div>
                <div>
                  <span className="font-semibold" style={{ color: "var(--color-success-700)" }}>{totalDownloaded.toLocaleString()}</span> downloaded ·{" "}
                  <span className="font-semibold" style={{ color: "var(--color-warning-700)" }}>{totalPending}</span> pending ·{" "}
                  <span className="font-semibold" style={{ color: "var(--color-danger-700)" }}>{totalStale}</span> stale
                </div>
                <div className="text-[11.5px] mt-1" style={{ color: "var(--color-text-faint)" }}>
                  {dormantSites} dormant sites · {totalSites - activeSites} inactive on Dalux
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Trend + Activity */}
      <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
        <SectionCard
          title="Forms raised — last 12 weeks"
          subtitle="By sector · use this to spot rising / falling engagement"
        >
          <div className="px-3 pt-2 pb-4">
            <TrendChart series={sectors.map(s => ({ name: s.name, color: sectorColor(s.name), values: s.trend }))} />
            <div className="flex gap-4 px-2 text-[11.5px] mt-1" style={{ color: "var(--color-text-muted)" }}>
              {sectors.map(s => <Legend key={s.name} color={sectorColor(s.name)} label={s.name} />)}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent activity"
          subtitle="Last 24 hours across the group"
          action={<a className="text-[12px]" style={{ color: "var(--color-brand-600)" }}>View all →</a>}
        >
          <div className="max-h-[360px] overflow-auto">
            {MOCK_FEED.map((f, i) => (
              <div key={i} className="flex gap-2.5 px-3.5 py-2.5 items-start border-b last:border-0" style={{ borderColor: "var(--color-border)" }}>
                <FeedIcon kind={f.kind} icon={f.icon} />
                <div className="flex-1 text-[12.5px] leading-snug">{f.text}</div>
                <div className="text-[11px] tabular shrink-0" style={{ color: "var(--color-text-faint)" }}>{f.time}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Attention list + 24h breakdown */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <SectionCard
          title="Sites needing attention"
          subtitle="Highest stale + pending counts, sorted by urgency"
          action={<a href="/sites" className="text-[12px]" style={{ color: "var(--color-brand-600)" }}>All sites →</a>}
        >
          {MOCK_ATTENTION.map(a => (
            <button
              key={a.sos}
              onClick={() => navigate(`/sites/${a.sos}`)}
              className="w-full text-left grid items-center gap-2.5 px-3.5 py-2.5 border-b last:border-0 hover:bg-[var(--color-surface-sunken)]"
              style={{ gridTemplateColumns: "1fr 70px 100px 24px", borderColor: "var(--color-border)" }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Tag tone="info">{a.sos}</Tag>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{a.name}</div>
                  <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
                    {a.sector} · {a.total} forms ·{" "}
                    <span style={{ color: "var(--color-warning-700)" }}>{a.pending} pending</span>
                    {a.stale ? <> · <span style={{ color: "var(--color-danger-700)" }}>{a.stale} stale</span></> : null}
                  </div>
                </div>
              </div>
              <div className="flex gap-1 justify-end">
                {a.stale > 0 && <Tag tone="danger">{a.stale}</Tag>}
                {a.pending > 0 && <Tag tone="warning">{a.pending}</Tag>}
              </div>
              <div>
                <div className="h-1 rounded overflow-hidden" style={{ background: "var(--color-surface-sunken)" }}>
                  <div style={{ width: `${a.pct}%`, height: "100%", background: a.stale > 0 ? "var(--color-danger-500)" : "var(--color-warning-500)" }} />
                </div>
                <div className="text-[11px] tabular text-right mt-0.5" style={{ color: "var(--color-text-faint)" }}>{a.pct}% downloaded</div>
              </div>
              <span style={{ color: "var(--color-text-faint)" }}>›</span>
            </button>
          ))}
        </SectionCard>

        <SectionCard title="Forms raised" subtitle="By sector & timeframe">
          <div className="p-3.5">
            {sectors.map(s => (
              <div key={s.name} className="grid items-center gap-2.5 mb-1" style={{ gridTemplateColumns: "110px 1fr 50px" }}>
                <span className="text-[12px] font-medium" style={{ color: sectorColor(s.name) }}>{s.name}</span>
                <Sparkline values={s.trend.slice(-7)} color={sectorColor(s.name)} width={200} height={28} />
                <span className="text-[12px] tabular text-right" style={{ fontFamily: "var(--font-mono)" }}>{s.trend[s.trend.length - 1]}</span>
              </div>
            ))}
            <div className="border-t mt-2 pt-2.5" style={{ borderColor: "var(--color-border)" }}>
              <SummaryRow label="Last 24h"     value={lastWeek} />
              <SummaryRow label="Last 7 days"  value={lastWeek + prevWeek + 18} />
              <SummaryRow label="Last 30 days" value={sectors.reduce((a, s) => a + s.trend.slice(-4).reduce((x, y) => x + y, 0), 0)} />
            </div>
          </div>
        </SectionCard>
      </div>
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

function FeedIcon({ kind, icon }: { kind: string; icon: string }) {
  const tones: Record<string, { bg: string; fg: string }> = {
    ok:   { bg: "var(--color-success-50)", fg: "var(--color-success-700)" },
    warn: { bg: "var(--color-warning-50)", fg: "var(--color-warning-700)" },
    err:  { bg: "var(--color-danger-50)",  fg: "var(--color-danger-700)" },
    info: { bg: "var(--color-brand-50)",   fg: "var(--color-brand-700)" },
  };
  const t = tones[kind] ?? tones.info;
  return (
    <div className="w-7 h-7 rounded grid place-items-center text-[12px] font-semibold shrink-0" style={{ background: t.bg, color: t.fg }}>
      {icon}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-[11.5px] py-0.5" style={{ color: "var(--color-text-muted)" }}>
      <span>{label}</span>
      <span className="font-semibold tabular" style={{ color: "var(--color-text)", fontFamily: "var(--font-mono)" }}>{value}</span>
    </div>
  );
}
