import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchSites, fetchFormTypes, fetchForms, type FormRow } from "../api";

export default function FormsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read filters from URL query params
  const siteIds = searchParams.getAll("site");  // multi-value
  const formType = searchParams.get("form_type") ?? "";
  const dateFrom = searchParams.get("date_from") ?? "";
  const dateTo = searchParams.get("date_to") ?? "";
  const status = searchParams.get("status") ?? "";
  const notDownloaded = searchParams.get("new_only") === "1";

  // Helper to update a single filter
  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  }

  // Helper to toggle site selection (multi-select)
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

  // --- Data queries ---
  const sitesQuery = useQuery({
    queryKey: ["sites"],
    queryFn: fetchSites,
  });

  const formTypesQuery = useQuery({
    queryKey: ["form-types"],
    queryFn: fetchFormTypes,
  });

  const formsQuery = useQuery({
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

  return (
    <div>
      {/* Filter bar */}
      <section className="bg-white rounded border border-gray-200 p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Filters</h2>
          {anyFilterActive && (
            <button
              onClick={clearFilters}
              className="text-xs text-[#233E99] hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Form type */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">
              Form type
            </label>
            <select
              value={formType}
              onChange={e => setFilter("form_type", e.target.value || null)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              disabled={formTypesQuery.isLoading}
            >
              <option value="">All types ({formTypesQuery.data?.length ?? 0})</option>
              {formTypesQuery.data?.filter(t => t.has_custom_report).map(t => (
                <option key={t.template_name} value={t.template_name}>
                  ✓ {t.template_name} ({t.form_count})
                </option>
              ))}
              <option disabled>── Without custom report ──</option>
              {formTypesQuery.data?.filter(t => !t.has_custom_report).map(t => (
                <option key={t.template_name} value={t.template_name}>
                  {t.template_name} ({t.form_count})
                </option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">
              Created from
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setFilter("date_from", e.target.value || null)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">
              Created to
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setFilter("date_to", e.target.value || null)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">
              Status
            </label>
            <select
              value={status}
              onChange={e => setFilter("status", e.target.value || null)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="">Any</option>
              <option value="closed">Closed</option>
              <option value="open">Open</option>
            </select>
          </div>

          {/* New-only toggle */}
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notDownloaded}
                onChange={e => setFilter("new_only", e.target.checked ? "1" : null)}
                className="w-4 h-4"
              />
              Only show not-yet-downloaded
            </label>
          </div>
        </div>

        {/* Site selector as chip list */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600 mb-2">
            Sites <span className="text-gray-500 font-normal">
              ({siteIds.length === 0 ? "all" : `${siteIds.length} selected`})
            </span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {sitesQuery.data?.filter(s => s.is_mapped === 1).map(s => {
              const selected = siteIds.includes(s.dalux_id);
              return (
                <button
                  key={s.dalux_id}
                  onClick={() => toggleSite(s.dalux_id)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    selected
                      ? "bg-[#233E99] text-white border-[#233E99]"
                      : "bg-white text-gray-700 border-gray-300 hover:border-[#233E99]"
                  }`}
                >
                  {s.sos_number} · {s.site_name}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Results */}
      {formsQuery.isLoading && <p className="text-gray-600">Loading forms…</p>}
      {formsQuery.error && (
        <p className="text-red-700">Error loading forms: {(formsQuery.error as Error).message}</p>
      )}
      {formsQuery.data && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">
              Results <span className="text-gray-500 font-normal">({formsQuery.data.count})</span>
            </h2>
            {formsQuery.data.count >= formsQuery.data.limit && (
              <span className="text-xs text-amber-700">
                Showing first {formsQuery.data.limit} — refine filters to see more
              </span>
            )}
          </div>
          <div className="bg-white rounded border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-600">
                  <th className="px-3 py-2 font-semibold">Form</th>
                  <th className="px-3 py-2 font-semibold">Site</th>
                  <th className="px-3 py-2 font-semibold">Created</th>
                  <th className="px-3 py-2 font-semibold">Modified</th>
                  <th className="px-3 py-2 font-semibold">By</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Downloads</th>
                  <th className="px-3 py-2 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {formsQuery.data.forms.map(f => (
                  <FormRowView key={f.formId} form={f} />
                ))}
                {formsQuery.data.forms.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                      No forms match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function FormRowView({ form }: { form: FormRow }) {
  const created = new Date(form.created).toLocaleDateString("en-GB");
  const modified = new Date(form.modified).toLocaleDateString("en-GB");
  const lastDownload = form.last_downloaded_at
    ? new Date(form.last_downloaded_at).toLocaleDateString("en-GB")
    : null;

  return (
    <tr className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
      <td className="px-3 py-2">
        <div className="font-medium">{form.number ?? form.formId}</div>
        <div className="text-xs text-gray-500">{form.template_name}</div>
      </td>
      <td className="px-3 py-2">
        {form.sos_number && (
          <span className="inline-block px-1.5 py-0.5 text-xs font-mono font-bold bg-[#EEF1FA] text-[#233E99] rounded mr-1.5">
            {form.sos_number}
          </span>
        )}
        <span className={form.is_mapped ? "" : "italic text-gray-600"}>
          {form.site_display}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{created}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        {modified}
        {form.modified_since_download && (
          <span className="ml-2 text-xs text-amber-700" title="Modified since last download">
            ⟳ updated
          </span>
        )}
      </td>
      <td className="px-3 py-2">{form.creator_name ?? "—"}</td>
      <td className="px-3 py-2">
        <span className={`inline-block px-2 py-0.5 text-xs rounded ${
          form.status === "closed" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
        }`}>
          {form.status}
        </span>
      </td>
      <td className="px-3 py-2 text-center">
        {form.download_count > 0 ? (
          <div>
            <span className="font-medium">{form.download_count}×</span>
            <div className="text-xs text-gray-500">{lastDownload}</div>
          </div>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {form.has_custom_report ? (
          <button
            onClick={() => alert(`Download stub — Session 5 will wire this up.\n\nForm: ${form.formId}`)}
            className="px-3 py-1 text-xs font-semibold bg-[#233E99] text-white rounded hover:bg-[#1a2f7a]"
          >
            Download PDF
          </button>
        ) : (
          <span className="text-xs text-gray-400" title="No custom report template configured for this form type">
            No template
          </span>
        )}
      </td>
    </tr>
  );
}