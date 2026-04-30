import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Tag, LoadingPanel, ErrorPanel } from "../components/ui";
import { Kpi, VelocityGrid, SectionCard, RangePill } from "../components/dashboard/kpi";
import { Sparkline, BarChart, Donut, sectorColor } from "../components/dashboard/charts";
import { fetchProjectDashboard } from "../api";

export default function ProjectDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sosNumber } = useParams<{ sosNumber: string }>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [singleBusy, setSingleBusy] = useState<string | null>(null);

  const projectQ = useQuery({
    queryKey: ["dashboard-project", sosNumber, "30d"],
    queryFn: () => fetchProjectDashboard(sosNumber!, "30d"),
    enabled: !!sosNumber,
  });

  function toggleRow(formId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(formId)) next.delete(formId); else next.add(formId);
      return next;
    });
  }

  async function downloadOne(formId: string, formNumber: string, status: string) {
    if (status !== "Closed" && status !== "Downloaded" && status !== "Stale") {
      const ok = window.confirm(
        `This form's status is "${status}" — it has not been closed yet.\n` +
        `The PDF may not reflect the final state.\n\nDownload anyway?`
      );
      if (!ok) return;
    }
    setSingleBusy(formId);
    try {
      const resp = await fetch(`/api/forms/${formId}/download`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        alert(`Download failed: ${err.detail ?? resp.statusText}`);
        return;
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `${formNumber || formId}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      // Refresh project data so status pills update
      queryClient.invalidateQueries({ queryKey: ["dashboard-project", sosNumber] });
    } catch (e) {
      alert(`Download error: ${(e as Error).message}`);
    } finally {
      setSingleBusy(null);
    }
  }

  async function downloadSelectedAsZip() {
    if (selected.size === 0) return;
    const recent = projectQ.data?.recent ?? [];
    const openSelected = recent.filter(
      r => selected.has(r.form_id) && r.status !== "Closed" && r.status !== "Downloaded" && r.status !== "Stale"
    );
    if (openSelected.length > 0) {
      const sample = openSelected.slice(0, 5).map(r => `  • ${r.number} (${r.status})`).join("\n");
      const more = openSelected.length > 5 ? `\n  …and ${openSelected.length - 5} more` : "";
      const ok = window.confirm(
        `${openSelected.length} of ${selected.size} selected form(s) are not closed yet — ` +
        `their PDFs may not reflect the final state:\n\n${sample}${more}\n\nDownload anyway?`
      );
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      const resp = await fetch("/api/forms/bulk-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form_ids: Array.from(selected) }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        alert(`Bulk download failed: ${typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail)}`);
        return;
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? "forms.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      const failed = Number(resp.headers.get("X-Failed-Count") ?? "0");
      if (failed > 0) alert(`${failed} form(s) could not be generated and were skipped.`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["dashboard-project", sosNumber] });
    } catch (e) {
      alert(`Bulk download error: ${(e as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  if (!sosNumber) return <div className="p-6"><ErrorPanel>No SOS number provided in URL.</ErrorPanel></div>;
  if (projectQ.isLoading) return <LoadingPanel>Loading {sosNumber}…</LoadingPanel>;
  if (projectQ.error) return <div className="p-6"><ErrorPanel>Failed to load {sosNumber}: {(projectQ.error as Error).message}</ErrorPanel></div>;

  const data = projectQ.data!;
  const p = data;
  const site = data.site;

  const last7 = p.daily.slice(-7).reduce((a, b) => a + b, 0);
  const prev7 = p.daily.slice(-14, -7).reduce((a, b) => a + b, 0);
  const weekDelta = last7 - prev7;
  const last24 = p.daily[p.daily.length - 1] ?? 0;
  const last30 = p.daily.reduce((a, b) => a + b, 0);
  const coverage = p.total > 0 ? Math.round((p.downloaded / p.total) * 100) : 0;
  const stalePct = p.total > 0 ? Math.round((p.stale / p.total) * 100) : 0;
  const pendingPct = p.total > 0 ? Math.round((p.pending / p.total) * 100) : 0;

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
              {site.sos_number && <Tag tone="info">{site.sos_number}</Tag>}
              {site.dalux_id && <Tag>{site.dalux_id}</Tag>}
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: sectorColor(site.sector) }}>
                <i className="inline-block w-2 h-2 rounded-sm" style={{ background: sectorColor(site.sector) }} />
                {site.sector}
              </span>
              {site.status && <Tag tone={site.status.toLowerCase() === "active" ? "success" : "neutral"}>{site.status}</Tag>}
            </div>
            <h1 className="text-[24px] font-semibold leading-tight m-0">{site.name}</h1>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              {site.client && <Field label="Client" value={site.client} />}
              {site.primary_contact && <Field label="Contact" value={site.primary_contact} />}
              {site.start_on_site_date && <Field label="Started" value={fmtDate(site.start_on_site_date)} />}
              {site.finish_on_site_date && <Field label="Expected end" value={fmtDate(site.finish_on_site_date)} />}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <RangePill active="30d" />
            <Button size="sm" variant="primary" onClick={() => navigate(`/forms?site=${site.dalux_id}`)}>
              See forms →
            </Button>
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
          spark={p.daily.length >= 2 ? <Sparkline values={p.daily.slice(-14)} color="var(--color-brand-600)" width={70} height={28} /> : undefined}
        />
        <Kpi
          label="This week"
          value={last7}
          delta={prev7 === 0 && last7 === 0 ? "no activity" : `${weekDelta >= 0 ? "↑" : "↓"} ${Math.abs(weekDelta)} vs last week`}
          deltaTone={weekDelta >= 0 ? "up" : "down"}
          spark={p.daily.length >= 2 ? <Sparkline values={p.daily.slice(-7)} color="var(--color-success-500)" width={70} height={28} /> : undefined}
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
          valueTone={p.pending > 0 ? "warning" : "text"}
          delta={p.total > 0 ? `${pendingPct}% of total` : "—"}
          deltaTone={p.pending > 0 ? "warn" : "neutral"}
        />
        <Kpi
          label="Stale"
          value={p.stale}
          valueTone={p.stale > 0 ? "danger" : "text"}
          delta={p.total > 0 ? `${stalePct}% — modified after dl` : "—"}
          deltaTone={p.stale > 0 ? "down" : "neutral"}
        />
      </div>

      {/* Activity */}
      <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "1.7fr 1fr" }}>
        <SectionCard title="Daily activity" subtitle="Forms raised per day, last 30 days">
          {p.daily.some(v => v > 0) ? (
            <BarChart values={p.daily} />
          ) : (
            <div className="p-12 text-center text-[12.5px]" style={{ color: "var(--color-text-faint)" }}>No activity in the last 30 days.</div>
          )}
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
              { label: "Open → Closed", value: <>{fmtDays(p.open_to_closed_days)}<small className="text-[12px] font-normal" style={{ color: "var(--color-text-muted)" }}>d</small></>, sub: "site avg" },
              { label: "Closed → DL",   value: <>{fmtDays(p.closed_to_dl_days)}<small className="text-[12px] font-normal" style={{ color: "var(--color-text-muted)" }}>d</small></>, sub: "site avg" },
              { label: "Templates",     value: p.templates.length, sub: "in use" },
              { label: "Contributors",  value: p.contributors.length, sub: "people" },
            ]} />
          </div>
        </SectionCard>
      </div>

      {/* Templates + contributors */}
      <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <SectionCard title="Form templates" subtitle="Mix of forms raised on this site (last 30d)">
          <div className="p-4">
            {p.templates.length === 0 ? (
              <div className="text-[12px]" style={{ color: "var(--color-text-faint)" }}>No forms raised in the last 30 days.</div>
            ) : (
              p.templates.map((t, i) => {
                const max = p.templates[0].count;
                const pct = max > 0 ? (t.count / max) * 100 : 0;
                return (
                  <div key={t.name} className="grid items-center gap-3 mb-2.5" style={{ gridTemplateColumns: "230px 1fr 80px" }}>
                    <span className="text-[12.5px] font-medium truncate" title={t.name}>{t.name}</span>
                    <div className="h-2.5 rounded overflow-hidden" style={{ background: "var(--color-surface-sunken)" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: paletteByIndex(i) }} />
                    </div>
                    <span className="text-[12px] tabular text-right" style={{ fontFamily: "var(--font-mono)" }}>{t.count} <span style={{ color: "var(--color-text-faint)" }}>({Math.round((t.count / Math.max(p.total, 1)) * 100)}%)</span></span>
                  </div>
                );
              })
            )}
          </div>
        </SectionCard>

        <SectionCard title="Top contributors" subtitle="People raising forms on this site">
          <div className="p-4">
            {p.contributors.length === 0 ? (
              <div className="text-[12px]" style={{ color: "var(--color-text-faint)" }}>No contributors in range.</div>
            ) : (
              p.contributors.map(c => {
                const max = p.contributors[0].forms;
                const pct = max > 0 ? (c.forms / max) * 100 : 0;
                return (
                  <div key={c.name} className="grid items-center gap-3 mb-2.5" style={{ gridTemplateColumns: "180px 1fr 40px" }}>
                    <div>
                      <div className="text-[12.5px] font-medium truncate" title={c.name}>{c.name}</div>
                      {c.role && <div className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>{c.role}</div>}
                    </div>
                    <div className="h-2.5 rounded overflow-hidden" style={{ background: "var(--color-surface-sunken)" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "var(--color-brand-600)" }} />
                    </div>
                    <span className="text-[12.5px] font-semibold tabular text-right" style={{ fontFamily: "var(--font-mono)" }}>{c.forms}</span>
                  </div>
                );
              })
            )}
          </div>
        </SectionCard>
      </div>

      {/* Recent forms */}
      {(() => {
        const allSelectable = p.recent.every(r => selected.has(r.form_id));
        function toggleAll() {
          setSelected(prev => {
            const next = new Set(prev);
            if (allSelectable) p.recent.forEach(r => next.delete(r.form_id));
            else p.recent.forEach(r => next.add(r.form_id));
            return next;
          });
        }
        return (
          <SectionCard
            title="Recent forms"
            subtitle={`Latest activity on this site · pick one or many to download${p.recent.length >= 50 ? ` (showing first 50)` : ""}`}
            action={<a href={`/forms?site=${site.dalux_id}`} className="text-[12px]" style={{ color: "var(--color-brand-600)" }}>All forms →</a>}
          >
            {p.recent.length === 0 ? (
              <div className="p-8 text-center text-[12.5px]" style={{ color: "var(--color-text-faint)" }}>No recent forms.</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ background: "var(--color-surface-sunken)" }}>
                    <th className="px-4 py-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={p.recent.length > 0 && allSelectable}
                        onChange={toggleAll}
                        title="Select all forms shown"
                        className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
                      />
                    </th>
                    <Th>Form</Th><Th>Template</Th><Th>Raised by</Th><Th>When</Th><Th>Status</Th>
                    <th className="px-4 py-2.5 text-right font-semibold text-[11px] uppercase tracking-wider" style={{ color: "var(--color-text-faint)" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {p.recent.map(r => {
                    const isSelected = selected.has(r.form_id);
                    const isBusy = singleBusy === r.form_id;
                    return (
                      <tr
                        key={r.form_id}
                        className="border-t hover:bg-[var(--color-surface-sunken)]"
                        style={{
                          borderColor: "var(--color-border)",
                          background: isSelected ? "var(--color-brand-50)" : undefined,
                        }}
                      >
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(r.form_id)}
                            className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
                          />
                        </td>
                        <Td><span className="tabular font-medium" style={{ fontFamily: "var(--font-mono)" }}>{r.number}</span></Td>
                        <Td className="truncate max-w-[260px]" title={r.template}>{r.template}</Td>
                        <Td style={{ color: "var(--color-text-muted)" }}>{r.by}</Td>
                        <Td style={{ color: "var(--color-text-muted)" }}>{relativeTime(r.when_iso)}</Td>
                        <Td>
                          <Tag tone={
                            r.status === "Downloaded" ? "success"
                            : r.status === "Stale"    ? "danger"
                            : r.status === "Closed"   ? "info"
                            : "warning"
                          }>{r.status}</Tag>
                        </Td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isBusy}
                            onClick={() => downloadOne(r.form_id, r.number, r.status)}
                          >
                            {isBusy ? "…" : "Download"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </SectionCard>
        );
      })()}

      {/* Floating bulk action */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full shadow-lg border z-50"
          style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border-strong)" }}
        >
          <span className="text-[13px] font-medium tabular">{selected.size} selected</span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-[12px] hover:underline"
            disabled={bulkBusy}
            style={{ color: "var(--color-text-muted)" }}
          >Clear</button>
          <Button
            variant="primary"
            onClick={downloadSelectedAsZip}
            disabled={bulkBusy}
            leadingIcon={bulkBusy && (
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
            )}
          >
            {bulkBusy ? "Generating ZIP…" : `Download ${selected.size} as ZIP`}
          </Button>
        </div>
      )}
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
function Td({ children, className = "", style = {}, title }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties; title?: string }) {
  return <td className={`px-4 py-2.5 ${className}`} style={style} title={title}>{children}</td>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB");
}

function fmtDays(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return v.toFixed(1);
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

const PALETTE = [
  "var(--color-brand-600)",
  "#1B7A4D",
  "#B86A00",
  "#7C3AED",
  "#0891B2",
  "#DB2777",
  "var(--color-brand-400)",
  "var(--color-text-muted)",
];
function paletteByIndex(i: number): string {
  return PALETTE[i % PALETTE.length];
}
