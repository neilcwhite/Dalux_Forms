import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  fetchSites,
  fetchSiteFormSummary,
  fetchAdminProjects,
  type Site,
  type SiteTemplateSummary,
} from "../api";
import { Card, Tag, Button, PageHeader, LoadingPanel, ErrorPanel } from "../components/ui";

export default function SitesPage() {
  const sitesQ = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const summaryQ = useQuery({ queryKey: ["site-form-summary"], queryFn: () => fetchSiteFormSummary() });
  // Reuses the same query key as AdminPage, so hide/unhide there refreshes
  // this page automatically via TanStack's shared cache.
  const adminQ = useQuery({ queryKey: ["admin-projects"], queryFn: fetchAdminProjects });

  // Hooks must run on every render — keep useMemo above the early returns
  // so React sees a stable hook count regardless of loading/error state.
  const grouped = useMemo(() => {
    const sites = sitesQ.data ?? [];
    const summary = summaryQ.data ?? {};
    const hiddenIds = new Set(
      (adminQ.data ?? []).filter(p => p.status === "hidden").map(p => p.dalux_project_id)
    );
    const mapped = sites.filter(s => s.is_mapped === 1);
    // Hidden projects are dropped from the unmapped bucket — manage them on /admin.
    const unmappedAll = sites.filter(s => s.is_mapped === 0);
    const unmapped = unmappedAll.filter(s => !hiddenIds.has(s.dalux_id));
    const hiddenCount = unmappedAll.length - unmapped.length;
    const stale: Site[] = [];
    const pending: Site[] = [];
    const ok: Site[] = [];
    mapped.forEach(s => {
      const sum = summary[s.dalux_id];
      if (sum?.stale_undownloaded && sum.stale_undownloaded > 0) stale.push(s);
      else if (sum?.undownloaded_forms && sum.undownloaded_forms > 0) pending.push(s);
      else ok.push(s);
    });
    return { mapped, unmapped, hiddenCount, summary, buckets: { stale, pending, ok } };
  }, [sitesQ.data, summaryQ.data, adminQ.data]);

  if (sitesQ.isLoading) return <LoadingPanel>Loading sites…</LoadingPanel>;
  if (sitesQ.error) return <div className="p-6"><ErrorPanel>{(sitesQ.error as Error).message}</ErrorPanel></div>;

  const { mapped, unmapped, hiddenCount, summary, buckets } = grouped;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Sites"
        subtitle={
          `${mapped.length} mapped · ${unmapped.length} unmapped Dalux projects` +
          (hiddenCount > 0 ? ` · ${hiddenCount} hidden (manage in Admin)` : "")
        }
      />

      {buckets.stale.length > 0 && (
        <SiteBucket
          title="Needs attention"
          tone="danger"
          subtitle="Forms have been modified after their last download"
          sites={buckets.stale}
          summary={summary}
        />
      )}
      {buckets.pending.length > 0 && (
        <SiteBucket
          title="Awaiting download"
          tone="warning"
          subtitle="Forms exist that have never been downloaded"
          sites={buckets.pending}
          summary={summary}
        />
      )}
      {buckets.ok.length > 0 && (
        <SiteBucket
          title="All caught up"
          tone="success"
          subtitle="Every form has a fresh report"
          sites={buckets.ok}
          summary={summary}
        />
      )}

      {unmapped.length > 0 && (
        <SiteBucket
          title="Unmapped Dalux projects"
          tone="neutral"
          subtitle="Not yet linked to a SHEQ site — no SOS number, no custom reports"
          sites={unmapped}
          summary={summary}
          unmapped
        />
      )}
    </div>
  );
}

function SiteBucket({
  title, subtitle, tone, sites, summary, unmapped,
}: {
  title: string;
  subtitle: string;
  tone: "success" | "warning" | "danger" | "neutral";
  sites: Site[];
  summary: Record<string, { templates: SiteTemplateSummary[]; total_forms: number; undownloaded_forms: number; stale_undownloaded: number; }>;
  unmapped?: boolean;
}) {
  const dotBg: Record<string, string> = {
    success: "var(--color-success-500)",
    warning: "var(--color-warning-500)",
    danger:  "var(--color-danger-500)",
    neutral: "var(--color-text-faint)",
  };
  return (
    <section className="mb-6">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="h-2 w-2 rounded-full" style={{ background: dotBg[tone] }} />
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <span className="text-[12px] tabular" style={{ color: "var(--color-text-faint)" }}>{sites.length}</span>
        <span className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>· {subtitle}</span>
      </div>
      <Card padded={false}>
        <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
          {sites.map(site => {
            const sum = summary[site.dalux_id];
            return (
              <SiteRow
                key={site.dalux_id}
                site={site}
                sum={sum}
                unmapped={unmapped}
              />
            );
          })}
        </div>
      </Card>
    </section>
  );
}

function SiteRow({
  site, sum, unmapped,
}: {
  site: Site;
  sum?: { templates: SiteTemplateSummary[]; total_forms: number; undownloaded_forms: number; stale_undownloaded: number; };
  unmapped?: boolean;
}) {
  const display = site.site_name || site.dalux_name;
  const pct = sum && sum.total_forms > 0
    ? Math.round(((sum.total_forms - sum.undownloaded_forms) / sum.total_forms) * 100)
    : 100;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {site.sos_number ? (
        <Tag tone="brand">{site.sos_number}</Tag>
      ) : (
        <span className="inline-block w-[64px] text-[10.5px] uppercase tracking-wider text-center px-2 py-0.5 rounded border"
          style={{ color: "var(--color-text-faint)", borderColor: "var(--color-border)" }}>
          No SOS
        </span>
      )}

      <div className="flex-1 min-w-0">
        <div className={`text-[13px] truncate ${unmapped ? "italic" : "font-medium"}`}
          style={unmapped ? { color: "var(--color-text-muted)" } : undefined}>
          {display}
        </div>
        {sum && sum.templates.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {sum.templates.map(t => (
              <span
                key={t.template_name}
                title={`${t.template_name} — ${t.count} form${t.count === 1 ? "" : "s"}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10.5px] font-mono rounded border tabular"
                style={{
                  background: "var(--color-success-50)",
                  color: "var(--color-success-700)",
                  borderColor: "var(--color-success-200)",
                }}
              >
                {t.short_code}<span style={{ color: "var(--color-success-500)" }}>×{t.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {sum && (
        <>
          <div className="text-right text-[11.5px] w-28 shrink-0" style={{ color: "var(--color-text-muted)" }}>
            <div className="tabular" style={{ color: "var(--color-text)" }}>{sum.total_forms} <span style={{ color: "var(--color-text-faint)" }}>forms</span></div>
            <div className="tabular">{sum.undownloaded_forms} pending</div>
          </div>
          <div className="w-32 shrink-0">
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-surface-sunken)" }}>
              <div
                className="h-full"
                style={{
                  width: `${pct}%`,
                  background: sum.stale_undownloaded > 0 ? "var(--color-danger-500)" : sum.undownloaded_forms > 0 ? "var(--color-warning-500)" : "var(--color-success-500)",
                }}
              />
            </div>
            <div className="text-[10px] mt-1 text-right tabular" style={{ color: "var(--color-text-faint)" }}>{pct}%</div>
          </div>
          <div className="flex items-center gap-1.5 w-32 shrink-0 justify-end">
            {sum.stale_undownloaded > 0 && <Tag tone="danger">{sum.stale_undownloaded}</Tag>}
            {sum.undownloaded_forms > 0 && sum.stale_undownloaded === 0 && <Tag tone="warning">{sum.undownloaded_forms}</Tag>}
            {sum.undownloaded_forms === 0 && <Tag tone="success">✓</Tag>}
          </div>
        </>
      )}

      <Link to={`/forms?site=${encodeURIComponent(site.dalux_id)}`}>
        <Button size="sm" variant="ghost">Open →</Button>
      </Link>
    </div>
  );
}
