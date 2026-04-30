import { useParams, useNavigate } from "react-router-dom";
import { Button, Tag } from "../components/ui";
import { Kpi, VelocityGrid, SectionCard, RangePill } from "../components/dashboard/kpi";
import { Sparkline, BarChart, Donut, sectorColor } from "../components/dashboard/charts";

/* ============================================================
   Per-project (site) dashboard
   TODO: replace mock with /api/dashboard/projects/:sos?range=...
   ============================================================ */

// MOCK DATA START -----------------------------------------------
const MOCK_PROJECT = {
  sos: "SOS-2204",
  daluxId: "DLX-9981-CH2",
  name: "Crewe Hub Phase 2",
  sector: "Rail",
  client: "Network Rail",
  pm: "Sarah Donnelly",
  start: "2024-08-12",
  expectedEnd: "2026-12-20",
  status: "Active",
  // 30-day daily counts
  daily: [3,2,4,5,2,1,0,1,3,5,4,3,6,4,2,3,5,4,7,3,2,1,4,5,3,2,0,3,5,4],
  total: 64,
  downloaded: 39,
  pending: 18,
  stale: 7,
  openToClosed: 5.8,
  closedToDl: 2.4,
  templates: [
    { name: "Risk Assessment",      count: 22, color: "#1B7A4D" },
    { name: "Method Statement",     count: 14, color: "#233E99" },
    { name: "Permit to Work",       count: 16, color: "#B86A00" },
    { name: "Daily Briefing",       count: 8,  color: "#5C7CCB" },
    { name: "Inspection",           count: 4,  color: "#8AA0DC" },
  ],
  contributors: [
    { name: "Tom Whitaker",   role: "Site Engineer",      forms: 18 },
    { name: "Priya Shah",     role: "Site Engineer",      forms: 14 },
    { name: "Daniel O'Hara",  role: "SHEQ Advisor",       forms: 11 },
    { name: "Marcus Reid",    role: "Section Engineer",   forms:  9 },
    { name: "Other (3)",      role: "—",                  forms: 12 },
  ],
  recent: [
    { id: "F-2204-189", template: "Permit to Work",     by: "Tom Whitaker",  when: "2h ago",       status: "Open"       },
    { id: "F-2204-188", template: "Risk Assessment",    by: "Priya Shah",    when: "5h ago",       status: "Closed"     },
    { id: "F-2204-187", template: "Daily Briefing",     by: "Tom Whitaker",  when: "Yesterday",    status: "Downloaded" },
    { id: "F-2204-186", template: "Method Statement",   by: "Daniel O'Hara", when: "Yesterday",    status: "Open"       },
    { id: "F-2204-185", template: "Inspection",         by: "Marcus Reid",   when: "2 days ago",   status: "Stale"      },
    { id: "F-2204-184", template: "Risk Assessment",    by: "Priya Shah",    when: "3 days ago",   status: "Downloaded" },
  ] as const,
};
// MOCK DATA END -------------------------------------------------

export default function ProjectDashboardPage() {
  const navigate = useNavigate();
  useParams<{ sosNumber: string }>(); // would be used to fetch real project
  const p = MOCK_PROJECT;

  const last7 = p.daily.slice(-7).reduce((a, b) => a + b, 0);
  const prev7 = p.daily.slice(-14, -7).reduce((a, b) => a + b, 0);
  const weekDelta = last7 - prev7;
  const last24 = p.daily[p.daily.length - 1];
  const last30 = p.daily.reduce((a, b) => a + b, 0);
  const coverage = Math.round((p.downloaded / p.total) * 100);
  const stalePct = Math.round((p.stale / p.total) * 100);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <button onClick={() => navigate("/sites")} className="text-[12px] mb-3 hover:underline flex items-center gap-1" style={{ color: "var(--color-brand-600)" }}>
        ← All sites
      </button>

      {/* Hero */}
      <div className="rounded border p-5 mb-3" style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)" }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-2 flex-wrap">
              <Tag tone="info">{p.sos}</Tag>
              <Tag>{p.daluxId}</Tag>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: sectorColor(p.sector) }}>
                <i className="inline-block w-2 h-2 rounded-sm" style={{ background: sectorColor(p.sector) }} />
                {p.sector}
              </span>
              <Tag tone="success">{p.status}</Tag>
            </div>
            <h1 className="text-[24px] font-semibold leading-tight m-0">{p.name}</h1>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              <Field label="Client" value={p.client} />
              <Field label="PM" value={p.pm} />
              <Field label="Started" value={p.start} />
              <Field label="Expected end" value={p.expectedEnd} />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <RangePill active="30d" />
            <Button size="sm">Export</Button>
            <Button size="sm" variant="primary">Open in Dalux ↗</Button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3 mb-3">
        <Kpi
          label="Total forms"
          value={p.total}
          delta={`${last30} in last 30 days`}
          deltaTone="neutral"
          spark={<Sparkline values={p.daily.slice(-14)} color="var(--color-brand-600)" width={70} height={28} />}
        />
        <Kpi
          label="This week"
          value={last7}
          delta={`${weekDelta >= 0 ? "↑" : "↓"} ${Math.abs(weekDelta)} vs last week`}
          deltaTone={weekDelta >= 0 ? "up" : "down"}
          spark={<Sparkline values={p.daily.slice(-7)} color="var(--color-success-500)" width={70} height={28} />}
        />
        <Kpi
          label="Last 24h"
          value={last24}
          delta="forms raised today"
          deltaTone="neutral"
        />
        <Kpi
          label="Pending"
          value={p.pending}
          valueTone="warning"
          delta={`${Math.round((p.pending / p.total) * 100)}% of total`}
          deltaTone="warn"
        />
        <Kpi
          label="Stale"
          value={p.stale}
          valueTone="danger"
          delta={`${stalePct}% — modified after dl`}
          deltaTone="down"
        />
      </div>

      {/* Activity */}
      <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "1.7fr 1fr" }}>
        <SectionCard title="Daily activity" subtitle="Forms raised per day, last 30 days">
          <BarChart values={p.daily} />
        </SectionCard>

        <SectionCard title="Reporting health" subtitle="How forms are flowing through this site">
          <div className="p-4">
            <div className="flex items-center gap-4 mb-4">
              <Donut downloaded={p.downloaded} pending={p.pending} stale={p.stale} size={88} />
              <div className="flex-1">
                <div className="text-[14px] font-semibold mb-1.5">{coverage}% coverage</div>
                <div className="text-[11.5px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  <div><span className="font-semibold tabular" style={{ color: "var(--color-success-700)", fontFamily: "var(--font-mono)" }}>{p.downloaded}</span> downloaded</div>
                  <div><span className="font-semibold tabular" style={{ color: "var(--color-warning-700)", fontFamily: "var(--font-mono)" }}>{p.pending}</span> pending download</div>
                  <div><span className="font-semibold tabular" style={{ color: "var(--color-danger-700)", fontFamily: "var(--font-mono)" }}>{p.stale}</span> stale (modified after dl)</div>
                </div>
              </div>
            </div>
            <VelocityGrid items={[
              { label: "Open → Closed",       value: <>{p.openToClosed.toFixed(1)}<small className="text-[12px] font-normal" style={{ color: "var(--color-text-muted)" }}>d</small></>, sub: "site avg" },
              { label: "Closed → DL",         value: <>{p.closedToDl.toFixed(1)}<small className="text-[12px] font-normal" style={{ color: "var(--color-text-muted)" }}>d</small></>, sub: "site avg" },
              { label: "Templates",           value: p.templates.length, sub: "in use" },
              { label: "Contributors",        value: 7, sub: "people" },
            ]} />
          </div>
        </SectionCard>
      </div>

      {/* Templates + contributors */}
      <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <SectionCard title="Form templates" subtitle="Mix of forms raised on this site (last 30d)">
          <div className="p-4">
            {p.templates.map(t => {
              const pct = (t.count / p.total) * 100;
              return (
                <div key={t.name} className="grid items-center gap-3 mb-2.5" style={{ gridTemplateColumns: "150px 1fr 60px" }}>
                  <span className="text-[12.5px] font-medium">{t.name}</span>
                  <div className="h-2.5 rounded overflow-hidden" style={{ background: "var(--color-surface-sunken)" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: t.color }} />
                  </div>
                  <span className="text-[12px] tabular text-right" style={{ fontFamily: "var(--font-mono)" }}>{t.count} <span style={{ color: "var(--color-text-faint)" }}>({Math.round(pct)}%)</span></span>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Top contributors" subtitle="People raising forms on this site">
          <div className="p-4">
            {p.contributors.map(c => {
              const max = p.contributors[0].forms;
              const pct = (c.forms / max) * 100;
              return (
                <div key={c.name} className="grid items-center gap-3 mb-2.5" style={{ gridTemplateColumns: "180px 1fr 40px" }}>
                  <div>
                    <div className="text-[12.5px] font-medium">{c.name}</div>
                    <div className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>{c.role}</div>
                  </div>
                  <div className="h-2.5 rounded overflow-hidden" style={{ background: "var(--color-surface-sunken)" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: "var(--color-brand-600)" }} />
                  </div>
                  <span className="text-[12.5px] font-semibold tabular text-right" style={{ fontFamily: "var(--font-mono)" }}>{c.forms}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* Recent forms */}
      <SectionCard
        title="Recent forms"
        subtitle="Latest activity on this site"
        action={<a href={`/forms?site_id=${p.sos}`} className="text-[12px]" style={{ color: "var(--color-brand-600)" }}>All forms →</a>}
      >
        <table className="w-full text-[12.5px]">
          <thead>
            <tr style={{ background: "var(--color-surface-sunken)" }}>
              <Th>Form ID</Th><Th>Template</Th><Th>Raised by</Th><Th>When</Th><Th>Status</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {p.recent.map(r => (
              <tr key={r.id} className="border-t hover:bg-[var(--color-surface-sunken)]" style={{ borderColor: "var(--color-border)" }}>
                <Td><span className="tabular font-medium" style={{ fontFamily: "var(--font-mono)" }}>{r.id}</span></Td>
                <Td>{r.template}</Td>
                <Td style={{ color: "var(--color-text-muted)" }}>{r.by}</Td>
                <Td style={{ color: "var(--color-text-muted)" }}>{r.when}</Td>
                <Td>
                  <Tag tone={
                    r.status === "Downloaded" ? "success"
                    : r.status === "Stale"    ? "danger"
                    : r.status === "Closed"   ? "info"
                    : "warning"
                  }>{r.status}</Tag>
                </Td>
                <Td className="text-right" style={{ color: "var(--color-text-faint)" }}>›</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-[10.5px] uppercase tracking-wider font-semibold mr-1.5" style={{ color: "var(--color-text-faint)" }}>{label}</span>
      <span style={{ color: "var(--color-text)" }}>{value}</span>
    </span>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left font-semibold text-[11px] uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>{children}</th>;
}
function Td({ children, className = "", style = {} }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <td className={`px-4 py-2.5 ${className}`} style={style}>{children}</td>;
}
