import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  fetchSites,
  fetchSiteFormSummary,
  type Site,
  type SiteTemplateSummary,
} from "../api";

export default function SitesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sites"],
    queryFn: fetchSites,
  });
  const summaryQuery = useQuery({
    queryKey: ["site-form-summary"],
    queryFn: fetchSiteFormSummary,
  });

  if (isLoading) return <p className="p-8 text-gray-600">Loading sites…</p>;
  if (error) return <p className="p-8 text-red-700">Error: {(error as Error).message}</p>;

  const mapped = data?.filter(s => s.is_mapped === 1) ?? [];
  const unmapped = data?.filter(s => s.is_mapped === 0) ?? [];
  const summary = summaryQuery.data ?? {};

  return (
    <>
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">
          Mapped sites <span className="text-gray-500 font-normal">({mapped.length})</span>
        </h2>
        <div className="bg-white rounded border border-gray-200 overflow-hidden">
          {mapped.map(s => (
            <SiteRow key={s.dalux_id} site={s} templates={summary[s.dalux_id]?.templates ?? []} />
          ))}
        </div>
      </section>

      {unmapped.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            Unmapped Dalux projects
            <span className="text-gray-500 font-normal">({unmapped.length})</span>
            <span className="text-xs font-normal text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
              Not linked to SHEQ site
            </span>
          </h2>
          <div className="bg-white rounded border border-gray-200 overflow-hidden">
            {unmapped.map(s => (
              <SiteRow key={s.dalux_id} site={s} templates={summary[s.dalux_id]?.templates ?? []} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function SiteRow({ site, templates }: { site: Site; templates: SiteTemplateSummary[] }) {
  const display = site.site_name || site.dalux_name;
  return (
    <Link
      to={`/?site=${encodeURIComponent(site.dalux_id)}`}
      className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 no-underline text-inherit"
    >
      {site.is_mapped === 1 && (
        <span className="inline-block px-2 py-0.5 text-xs font-mono font-bold bg-[#EEF1FA] text-[#233E99] rounded">
          {site.sos_number}
        </span>
      )}
      <span className={site.is_mapped === 1 ? "font-medium" : "italic text-gray-600"}>
        {display}
      </span>
      {templates.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {templates.map(t => (
            <span
              key={t.template_name}
              title={`${t.template_name} — ${t.count} form${t.count === 1 ? "" : "s"}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono bg-green-50 text-green-800 border border-green-200 rounded"
            >
              {t.short_code}
              <span className="text-green-600">×{t.count}</span>
            </span>
          ))}
        </span>
      )}
      {site.sheq_status && (
        <span className="text-xs text-gray-500 ml-auto">{site.sheq_status}</span>
      )}
      {site.is_mapped === 0 && (
        <span className="text-xs text-amber-700 ml-auto">Dalux only</span>
      )}
    </Link>
  );
}
