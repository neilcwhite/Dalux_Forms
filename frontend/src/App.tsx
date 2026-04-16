import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fetchSites, type Site } from "./api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

function SitesList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sites"],
    queryFn: fetchSites,
  });

  if (isLoading) return <p className="p-8 text-gray-600">Loading sites…</p>;
  if (error) return <p className="p-8 text-red-700">Error: {(error as Error).message}</p>;

  const mapped = data?.filter(s => s.is_mapped === 1) ?? [];
  const unmapped = data?.filter(s => s.is_mapped === 0) ?? [];

  return (
    <div className="max-w-5xl mx-auto p-6">
      <header className="mb-6 pb-4 border-b-2 border-[#233E99]">
        <h1 className="text-2xl font-bold text-[#233E99]">Dalux Report Portal</h1>
        <p className="text-sm text-gray-600 mt-1">Local prototype · connected to live MariaDB</p>
      </header>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">
          Mapped sites <span className="text-gray-500 font-normal">({mapped.length})</span>
        </h2>
        <div className="bg-white rounded border border-gray-200 overflow-hidden">
          {mapped.map(s => (
            <SiteRow key={s.dalux_id} site={s} />
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
              <SiteRow key={s.dalux_id} site={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SiteRow({ site }: { site: Site }) {
  const display = site.site_name || site.dalux_name;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
      {site.is_mapped === 1 && (
        <span className="inline-block px-2 py-0.5 text-xs font-mono font-bold bg-[#EEF1FA] text-[#233E99] rounded">
          {site.sos_number}
        </span>
      )}
      <span className={site.is_mapped === 1 ? "font-medium" : "italic text-gray-600"}>
        {display}
      </span>
      {site.sheq_status && (
        <span className="text-xs text-gray-500 ml-auto">{site.sheq_status}</span>
      )}
      {site.is_mapped === 0 && (
        <span className="text-xs text-amber-700 ml-auto">Dalux only</span>
      )}
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SitesList />
    </QueryClientProvider>
  );
}