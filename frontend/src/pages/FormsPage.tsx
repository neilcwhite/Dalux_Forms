import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSites, fetchFormTypes, fetchForms, fetchSiteFormSummary, type FormRow } from "../api";
import { Card, Tag, Button, PageHeader, StatusDot, LoadingPanel, ErrorPanel, EmptyState } from "../components/ui";

export default function FormsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [siteSearch, setSiteSearch] = useState("");

  // Read filters from URL query params (UNCHANGED from original)
  const siteIds = searchParams.getAll("site");
  const formType = searchParams.get("form_type") ?? "";
  const dateFrom = searchParams.get("date_from") ?? "";
  const dateTo = searchParams.get("date_to") ?? "";
  const status = searchParams.get("status") ?? "";
  const notDownloaded = searchParams.get("new_only") === "1";

  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  }
  function toggleSite(siteId: string) {
    const next = new URLSearchParams(searchParams);
    const current = next.getAll("site");
    next.delete("site");
    if (current.includes(siteId)) {
      current.filter(s => s !== siteId).forEach(s => next.append("site", s));
    } else {
      current.forEach(s => next.append("site", s));
      next.append("site", siteId);
    }
    setSearchParams(next);
  }
  function clearFilters() {
    setSearchParams(new URLSearchParams());
  }

  // Queries (UNCHANGED keys + fns)
  const sitesQuery       = useQuery({ queryKey: ["sites"],                          queryFn: fetchSites });
  const siteSummaryQuery = useQuery({ queryKey: ["site-form-summary", formType],    queryFn: () => fetchSiteFormSummary(formType || undefined) });
  const formTypesQuery   = useQuery({ queryKey: ["form-types"],                     queryFn: fetchFormTypes });
  const formsQuery       = useQuery({
    queryKey: ["forms", siteIds, formType, dateFrom, dateTo, status, notDownloaded],
    queryFn: () => fetchForms({
      site_id: siteIds.length ? siteIds : undefined,
      form_type: formType || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      status: status || undefined,
      not_downloaded_only: notDownloaded,
      limit: 500,
    }),
  });

  const anyFilterActive = siteIds.length > 0 || formType || dateFrom || dateTo || status || notDownloaded;
  const downloadableForms = (formsQuery.data?.forms ?? []).filter(f => f.has_custom_report);
  const allVisibleSelected = downloadableForms.length > 0 && downloadableForms.every(f => selected.has(f.formId));

  function toggleRow(formId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(formId)) next.delete(formId); else next.add(formId);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) downloadableForms.forEach(f => next.delete(f.formId));
      else downloadableForms.forEach(f => next.add(f.formId));
      return next;
    });
  }

  // Bulk download (UNCHANGED logic)
  async function downloadSelectedAsZip() {
    if (selected.size === 0) return;
    const allForms = formsQuery.data?.forms ?? [];
    const openSelected = allForms.filter(f => selected.has(f.formId) && f.status !== "closed");
    if (openSelected.length > 0) {
      const sample = openSelected.slice(0, 5).map(f => `  • ${f.number ?? f.formId} (${f.status})`).join("\n");
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
      queryClient.invalidateQueries({ queryKey: ["forms"] });
    } catch (e) {
      alert(`Bulk download error: ${(e as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  // Site rail data
  const mappedSites = (sitesQuery.data ?? []).filter(s => s.is_mapped === 1);
  const filteredRailSites = useMemo(() => {
    const q = siteSearch.trim().toLowerCase();
    if (!q) return mappedSites;
    return mappedSites.filter(s =>
      (s.site_name ?? s.dalux_name).toLowerCase().includes(q) ||
      (s.sos_number ?? "").toLowerCase().includes(q)
    );
  }, [mappedSites, siteSearch]);

  return (
    <div className="flex h-full">
      {/* Left rail: site picker */}
      <aside
        className="w-72 shrink-0 border-r flex flex-col"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <div className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--color-text-faint)" }}>Sites</div>
          <input
            type="text"
            value={siteSearch}
            onChange={e => setSiteSearch(e.target.value)}
            placeholder="Search sites…"
            className="w-full px-2.5 py-1.5 text-[12.5px] rounded border outline-none focus:border-[var(--color-brand-500)]"
            style={{ background: "var(--color-surface-sunken)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
          />
          <div className="flex items-center justify-between mt-2 text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
            <span>{siteIds.length === 0 ? "All sites" : `${siteIds.length} selected`}</span>
            {siteIds.length > 0 && (
              <button
                onClick={() => { const n = new URLSearchParams(searchParams); n.delete("site"); setSearchParams(n); }}
                className="hover:underline"
                style={{ color: "var(--color-brand-600)" }}
              >Clear</button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto py-1">
          {filteredRailSites.map(s => {
            const isSelected = siteIds.includes(s.dalux_id);
            const sum = siteSummaryQuery.data?.[s.dalux_id];
            const stale = sum?.stale_undownloaded ?? 0;
            const pending = sum?.undownloaded_forms ?? 0;
            const total = sum?.total_forms ?? 0;
            const tone: "danger" | "warning" | "success" | "neutral" =
              stale > 0 ? "danger" : pending > 0 ? "warning" : total > 0 ? "success" : "neutral";
            return (
              <button
                key={s.dalux_id}
                onClick={() => toggleSite(s.dalux_id)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-[var(--color-surface-sunken)] ${isSelected ? "bg-[var(--color-brand-50)]" : ""}`}
                style={isSelected ? { borderLeft: "3px solid var(--color-brand-600)", paddingLeft: 9 } : undefined}
              >
                <StatusDot tone={tone} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium truncate" style={{ color: "var(--color-text)" }}>
                    {s.site_name || s.dalux_name}
                  </div>
                  <div className="text-[10.5px] tabular truncate" style={{ color: "var(--color-text-faint)" }}>
                    {s.sos_number ?? "—"} · {total} forms
                  </div>
                </div>
                {(stale > 0 || pending > 0) && (
                  <span
                    className="text-[10.5px] font-semibold tabular px-1.5 py-0.5 rounded"
                    style={{
                      background: stale > 0 ? "var(--color-danger-50)" : "var(--color-warning-50)",
                      color: stale > 0 ? "var(--color-danger-700)" : "var(--color-warning-700)",
                    }}
                  >
                    {stale > 0 ? stale : pending}
                  </span>
                )}
              </button>
            );
          })}
          {filteredRailSites.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px]" style={{ color: "var(--color-text-faint)" }}>No sites match.</div>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="p-6 max-w-[1400px] mx-auto">
          <PageHeader
            title="Forms"
            subtitle={
              formsQuery.data
                ? `${formsQuery.data.count} form${formsQuery.data.count === 1 ? "" : "s"}${formsQuery.data.count >= formsQuery.data.limit ? ` · showing first ${formsQuery.data.limit}` : ""}`
                : "Loading…"
            }
            actions={anyFilterActive && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}
          />

          {/* Filter bar */}
          <Card className="mb-5">
            <div className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-4">
                <Label>Form type</Label>
                <select
                  value={formType}
                  onChange={e => setFilter("form_type", e.target.value || null)}
                  className="w-full px-2.5 py-1.5 text-[13px] rounded border outline-none focus:border-[var(--color-brand-500)]"
                  style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border-strong)", color: "var(--color-text)" }}
                  disabled={formTypesQuery.isLoading}
                >
                  <option value="">All types ({formTypesQuery.data?.length ?? 0})</option>
                  {formTypesQuery.data?.filter(t => t.has_custom_report).map(t => (
                    <option key={t.template_name} value={t.template_name}>✓ {t.display_name} ({t.form_count})</option>
                  ))}
                  <option disabled>── Without custom report ──</option>
                  {formTypesQuery.data?.filter(t => !t.has_custom_report).map(t => (
                    <option key={t.template_name} value={t.template_name}>{t.display_name} ({t.form_count})</option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <Label>From</Label>
                <DateInput value={dateFrom} onChange={v => setFilter("date_from", v || null)} />
              </div>
              <div className="col-span-2">
                <Label>To</Label>
                <DateInput value={dateTo} onChange={v => setFilter("date_to", v || null)} />
              </div>

              <div className="col-span-2">
                <Label>Status</Label>
                <select
                  value={status}
                  onChange={e => setFilter("status", e.target.value || null)}
                  className="w-full px-2.5 py-1.5 text-[13px] rounded border outline-none focus:border-[var(--color-brand-500)]"
                  style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border-strong)", color: "var(--color-text)" }}
                >
                  <option value="">Any</option>
                  <option value="closed">Closed</option>
                  <option value="open">Open</option>
                </select>
              </div>

              <label className="col-span-2 inline-flex items-center gap-2 text-[12.5px] cursor-pointer select-none" style={{ color: "var(--color-text)" }}>
                <input
                  type="checkbox"
                  checked={notDownloaded}
                  onChange={e => setFilter("new_only", e.target.checked ? "1" : null)}
                  className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
                />
                Pending only
              </label>
            </div>
          </Card>

          {/* Results */}
          {formsQuery.isLoading && <LoadingPanel>Loading forms…</LoadingPanel>}
          {formsQuery.error && <ErrorPanel>Error loading forms: {(formsQuery.error as Error).message}</ErrorPanel>}

          {formsQuery.data && (
            <Card padded={false}>
              <table className="w-full text-[13px]">
                <thead style={{ background: "var(--color-surface-sunken)" }}>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                    <th className="px-3 py-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        disabled={downloadableForms.length === 0}
                        title="Select all downloadable forms shown"
                        className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
                      />
                    </th>
                    <th className="px-3 py-2.5 font-semibold">Form</th>
                    <th className="px-3 py-2.5 font-semibold">Site</th>
                    <th className="px-3 py-2.5 font-semibold">Created</th>
                    <th className="px-3 py-2.5 font-semibold">Modified</th>
                    <th className="px-3 py-2.5 font-semibold">By</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Downloads</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {formsQuery.data.forms.map(f => (
                    <FormRowView
                      key={f.formId}
                      form={f}
                      isSelected={selected.has(f.formId)}
                      onToggle={() => toggleRow(f.formId)}
                    />
                  ))}
                  {formsQuery.data.forms.length === 0 && (
                    <tr><td colSpan={9}><EmptyState title="No forms match these filters" hint="Try clearing filters or selecting different sites." /></td></tr>
                  )}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>

      {/* Floating bulk action */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full shadow-lg border z-50"
          style={{
            background: "var(--color-surface-raised)",
            borderColor: "var(--color-border-strong)",
          }}
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

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--color-text-faint)" }}>{children}</div>
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 text-[13px] rounded border outline-none focus:border-[var(--color-brand-500)] tabular"
      style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border-strong)", color: "var(--color-text)" }}
    />
  );
}

function FormRowView({
  form, isSelected, onToggle,
}: { form: FormRow; isSelected: boolean; onToggle: () => void }) {
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const created = new Date(form.created).toLocaleDateString("en-GB");
  const modified = new Date(form.modified).toLocaleDateString("en-GB");
  const lastDownload = form.last_downloaded_at ? new Date(form.last_downloaded_at).toLocaleDateString("en-GB") : null;

  // Single-row download (UNCHANGED logic)
  async function handleDownload() {
    if (form.status !== "closed") {
      const ok = window.confirm(
        `This form's status is "${form.status}" — it has not been closed yet.\n` +
        `The PDF may not reflect the final state.\n\nDownload anyway?`
      );
      if (!ok) return;
    }
    setDownloading(true);
    try {
      const resp = await fetch(`/api/forms/${form.formId}/download`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        alert(`Download failed: ${err.detail ?? resp.statusText}`);
        return;
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `${form.formId}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      queryClient.invalidateQueries({ queryKey: ["forms"] });
    } catch (e) {
      alert(`Download error: ${(e as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <tr
      className="border-t hover:bg-[var(--color-surface-sunken)]"
      style={{
        borderColor: "var(--color-border)",
        background: isSelected ? "var(--color-brand-50)" : undefined,
      }}
    >
      <td className="px-3 py-2.5">
        {form.has_custom_report && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggle}
            className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
          />
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="font-medium tabular">{form.number ?? form.formId}</div>
        <div className="text-[11.5px]" style={{ color: "var(--color-text-faint)" }}>{form.template_name}</div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {form.sos_number && <Tag tone="brand">{form.sos_number}</Tag>}
          <span className={form.is_mapped ? "" : "italic"} style={!form.is_mapped ? { color: "var(--color-text-muted)" } : undefined}>
            {form.site_display}
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap tabular">{created}</td>
      <td className="px-3 py-2.5 whitespace-nowrap tabular">
        {modified}
        {form.modified_since_download && (
          <span className="ml-2 text-[11px]" style={{ color: "var(--color-warning-700)" }} title="Modified since last download">⟳ updated</span>
        )}
      </td>
      <td className="px-3 py-2.5" style={{ color: "var(--color-text-muted)" }}>{form.creator_name ?? "—"}</td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[12px]">
          <StatusDot tone={form.status === "closed" ? "success" : "warning"} />
          <span style={{ color: "var(--color-text)" }}>{form.status}</span>
        </span>
      </td>
      <td className="px-3 py-2.5">
        {form.download_count > 0 ? (
          <div className="leading-tight">
            <div className="text-[12.5px] tabular font-medium">{form.download_count}×</div>
            <div className="text-[11px] tabular" style={{ color: "var(--color-text-faint)" }}>{lastDownload}</div>
          </div>
        ) : (
          <span style={{ color: "var(--color-text-faint)" }}>—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {form.has_custom_report ? (
          <Button
            size="sm"
            variant="primary"
            onClick={handleDownload}
            disabled={downloading}
            leadingIcon={downloading && (
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
            )}
          >
            {downloading ? "Generating…" : "Download"}
          </Button>
        ) : (
          <span className="text-[11.5px]" style={{ color: "var(--color-text-faint)" }} title="No custom report template configured for this form type">
            No template
          </span>
        )}
      </td>
    </tr>
  );
}
