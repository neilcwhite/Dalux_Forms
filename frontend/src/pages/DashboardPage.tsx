import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Tag, Button, LoadingPanel, ErrorPanel } from "../components/ui";
import { Kpi, SectionCard, RangePill } from "../components/dashboard/kpi";
import { Sparkline } from "../components/dashboard/charts";
import {
  fetchDashboardGroup, fetchActivity,
  type DashboardRange, type ActivityEvent,
} from "../api";

/* ============================================================
   Operational dashboard — what needs my attention right now?
   Analytics (sector engagement, trend, reporting health) lives on
   /metrics so this stays focused.
   ============================================================ */

const KNOWN_RANGES: DashboardRange[] = ["7d", "30d", "90d", "1y", "all"];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<DashboardRange>("90d");

  const groupQ = useQuery({
    queryKey: ["dashboard-group", range],
    queryFn: () => fetchDashboardGroup(range),
  });
  const activityQ = useQuery({
    queryKey: ["activity", "24h", 20],
    queryFn: () => fetchActivity("24h", 20),
  });

  if (groupQ.isLoading) return <LoadingPanel>Loading dashboard…</LoadingPanel>;
  if (groupQ.error) return <div className="p-6"><ErrorPanel>Failed to load dashboard: {(groupQ.error as Error).message}</ErrorPanel></div>;

  const data = groupQ.data!;
  const sectors = data.sectors;
  const attention = data.attention;

  const totalSites = sectors.reduce((a, s) => a + s.sites, 0);
  const activeSites = sectors.reduce((a, s) => a + s.active, 0);
  const dormantSites = sectors.reduce((a, s) => a + s.dormant, 0);
  const totalForms = sectors.reduce((a, s) => a + s.total, 0);
  const totalPending = sectors.reduce((a, s) => a + s.pending, 0);
  const totalStale = sectors.reduce((a, s) => a + s.stale, 0);

  // Aggregate weekly trend by summing each week index across sectors
  const aggTrend = aggregateWeeklyTrend(sectors.map(s => s.trend));
  const lastWeek = aggTrend[aggTrend.length - 1] ?? 0;
  const prevWeek = aggTrend[aggTrend.length - 2] ?? 0;
  const weekDelta = lastWeek - prevWeek;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Dashboard"
        subtitle={`${activeSites} active sites · ${totalForms.toLocaleString()} forms in ${range} · ${totalPending.toLocaleString()} awaiting download`}
        actions={
          <>
            <RangePill ranges={KNOWN_RANGES as unknown as string[]} active={range} onChange={r => setRange(r as DashboardRange)} />
            <Button size="sm" variant="primary" onClick={() => navigate("/metrics")}>View metrics →</Button>
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
            <strong style={{ color: "var(--color-warning-700)" }}>
              {dormantSites} site{dormantSites === 1 ? " has" : "s have"} had no form activity in this period
            </strong>{" "}
            — <a href="/sites" className="underline" style={{ color: "var(--color-brand-600)" }}>Review →</a>
          </div>
        </div>
      )}

      {/* KPIs — at-a-glance status */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <Kpi
          label={`Active sites · ${range}`}
          value={activeSites}
          unit={`/ ${totalSites}`}
          delta={dormantSites > 0 ? `${dormantSites} dormant` : "all engaged"}
          deltaTone={dormantSites > 0 ? "warn" : "up"}
        />
        <Kpi
          label="Forms this week"
          value={lastWeek}
          delta={weekDelta === 0 ? "same as last week" : `${weekDelta >= 0 ? "↑" : "↓"} ${Math.abs(weekDelta)} vs last week`}
          deltaTone={weekDelta >= 0 ? "up" : "down"}
          spark={aggTrend.length >= 2 ? <Sparkline values={aggTrend} color="var(--color-brand-600)" /> : undefined}
        />
        <Kpi
          label="Pending downloads"
          value={totalPending.toLocaleString()}
          valueTone={totalPending > 0 ? "warning" : "text"}
          delta={totalForms > 0 ? `${Math.round((totalPending / totalForms) * 100)}% of forms in range` : "no forms in range"}
          deltaTone={totalPending > 0 ? "warn" : "neutral"}
        />
        <Kpi
          label="Stale"
          value={totalStale}
          valueTone={totalStale > 0 ? "danger" : "text"}
          delta={totalStale > 0 ? "modified after last download" : "nothing stale"}
          deltaTone={totalStale > 0 ? "down" : "up"}
        />
      </div>

      {/* Operational pair: Sites needing attention + Recent activity */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <SectionCard
          title="Sites needing attention"
          subtitle="Highest stale + pending counts cumulatively (across all time)"
          action={<a href="/sites" className="text-[12px]" style={{ color: "var(--color-brand-600)" }}>All sites →</a>}
        >
          {attention.length === 0 ? (
            <div className="p-8 text-center text-[12.5px]" style={{ color: "var(--color-success-700)" }}>
              All caught up — every form has been downloaded.
            </div>
          ) : attention.map(a => (
            <button
              key={a.dalux_id}
              onClick={() => a.sos_number && navigate(`/sites/${a.sos_number}`)}
              disabled={!a.sos_number}
              className="w-full text-left grid items-center gap-2.5 px-3.5 py-2.5 border-b last:border-0 hover:bg-[var(--color-surface-sunken)] disabled:cursor-default"
              style={{ gridTemplateColumns: "1fr 80px 100px 24px", borderColor: "var(--color-border)" }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {a.sos_number ? <Tag tone="info">{a.sos_number}</Tag> : <Tag tone="neutral">unmapped</Tag>}
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{a.site_name}</div>
                  <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
                    {a.sector} · {a.total} forms ·{" "}
                    <span style={{ color: "var(--color-warning-700)" }}>{a.pending} pending</span>
                    {a.stale > 0 && <> · <span style={{ color: "var(--color-danger-700)" }}>{a.stale} stale</span></>}
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
              <span style={{ color: a.sos_number ? "var(--color-text-faint)" : "transparent" }}>›</span>
            </button>
          ))}
        </SectionCard>

        <SectionCard
          title="Recent activity"
          subtitle="Last 24 hours"
          action={<a href="/forms" className="text-[12px]" style={{ color: "var(--color-brand-600)" }}>View all →</a>}
        >
          <div className="max-h-[480px] overflow-auto">
            {activityQ.isLoading && <div className="p-6 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>Loading…</div>}
            {activityQ.error && <div className="p-6 text-[12.5px]" style={{ color: "var(--color-danger-700)" }}>Couldn't load activity</div>}
            {activityQ.data && activityQ.data.events.length === 0 && (
              <div className="p-6 text-center text-[12.5px]" style={{ color: "var(--color-text-faint)" }}>
                Nothing happened in the last 24 hours.
              </div>
            )}
            {activityQ.data?.events.map((e, i) => (
              <div key={i} className="flex gap-2.5 px-3.5 py-2.5 items-start border-b last:border-0" style={{ borderColor: "var(--color-border)" }}>
                <FeedIcon event={e} />
                <div className="flex-1 text-[12.5px] leading-snug">{e.text}</div>
                <div className="text-[11px] tabular shrink-0" style={{ color: "var(--color-text-faint)" }}>{relativeTime(e.at)}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// --- helpers ---------------------------------------------------------------

function aggregateWeeklyTrend(series: number[][]): number[] {
  if (series.length === 0) return [];
  const len = Math.max(...series.map(s => s.length));
  const out = new Array(len).fill(0);
  for (const s of series) {
    for (let i = 0; i < s.length; i++) out[i] += s[i] ?? 0;
  }
  return out;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB");
}

function FeedIcon({ event }: { event: ActivityEvent }) {
  const tones: Record<string, { bg: string; fg: string }> = {
    ok:   { bg: "var(--color-success-50)", fg: "var(--color-success-700)" },
    warn: { bg: "var(--color-warning-50)", fg: "var(--color-warning-700)" },
    err:  { bg: "var(--color-danger-50)",  fg: "var(--color-danger-700)" },
    info: { bg: "var(--color-brand-50)",   fg: "var(--color-brand-700)" },
  };
  const t = tones[event.tone] ?? tones.info;
  return (
    <div className="w-7 h-7 rounded grid place-items-center text-[12px] font-semibold shrink-0" style={{ background: t.bg, color: t.fg }}>
      {event.icon}
    </div>
  );
}
