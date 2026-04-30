import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchAdminProjects,
  hideProject,
  unhideProject,
  type AdminProject,
  type ProjectStatus,
} from "../api";
import {
  Card, Tag, Button, PageHeader, LoadingPanel, ErrorPanel, EmptyState,
} from "../components/ui";

type View = "unmapped" | "hidden" | "all";

const VIEWS: View[] = ["unmapped", "hidden", "all"];

export default function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const rawView = searchParams.get("view");
  const view: View = (VIEWS as string[]).includes(rawView ?? "") ? (rawView as View) : "unmapped";

  function setView(next: View) {
    const sp = new URLSearchParams(searchParams);
    sp.set("view", next);
    setSearchParams(sp);
  }

  const projectsQ = useQuery({
    queryKey: ["admin-projects"],
    queryFn: fetchAdminProjects,
  });

  const hideMutation = useMutation({
    mutationFn: hideProject,
    onMutate: async (projectId: string) => {
      await queryClient.cancelQueries({ queryKey: ["admin-projects"] });
      const previous = queryClient.getQueryData<AdminProject[]>(["admin-projects"]);
      queryClient.setQueryData<AdminProject[]>(["admin-projects"], (rows) =>
        (rows ?? []).map(r =>
          r.dalux_project_id === projectId ? { ...r, status: "hidden" as ProjectStatus } : r,
        ),
      );
      return { previous };
    },
    onError: (_err, _projectId, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["admin-projects"], ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-projects"] });
    },
  });

  const unhideMutation = useMutation({
    mutationFn: unhideProject,
    onMutate: async (projectId: string) => {
      await queryClient.cancelQueries({ queryKey: ["admin-projects"] });
      const previous = queryClient.getQueryData<AdminProject[]>(["admin-projects"]);
      queryClient.setQueryData<AdminProject[]>(["admin-projects"], (rows) =>
        (rows ?? []).map(r => {
          if (r.dalux_project_id !== projectId) return r;
          // Revert to mapped if SOS exists, else unmapped
          const restored: ProjectStatus = r.sos_number ? "mapped" : "unmapped";
          return { ...r, status: restored };
        }),
      );
      return { previous };
    },
    onError: (_err, _projectId, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["admin-projects"], ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-projects"] });
    },
  });

  const all = projectsQ.data ?? [];
  const counts = useMemo(() => ({
    unmapped: all.filter(p => p.status === "unmapped").length,
    hidden:   all.filter(p => p.status === "hidden").length,
    all:      all.length,
  }), [all]);

  const filtered = useMemo(() => {
    if (view === "all") return all;
    return all.filter(p => p.status === view);
  }, [all, view]);

  const mutationError =
    (hideMutation.error as Error | null)?.message ??
    (unhideMutation.error as Error | null)?.message ??
    null;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Admin"
        subtitle="Dalux project mapping status. Hide projects you don't need to see in the worklist."
      />

      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-4">
        <FilterChip active={view === "unmapped"} onClick={() => setView("unmapped")}>
          Unmapped <span className="tabular ml-1.5 opacity-70">({counts.unmapped})</span>
        </FilterChip>
        <FilterChip active={view === "hidden"} onClick={() => setView("hidden")}>
          Hidden <span className="tabular ml-1.5 opacity-70">({counts.hidden})</span>
        </FilterChip>
        <FilterChip active={view === "all"} onClick={() => setView("all")}>
          All <span className="tabular ml-1.5 opacity-70">({counts.all})</span>
        </FilterChip>
      </div>

      {mutationError && (
        <div className="mb-4">
          <ErrorPanel>Action failed: {mutationError}</ErrorPanel>
        </div>
      )}

      {projectsQ.isLoading && <LoadingPanel>Loading projects…</LoadingPanel>}
      {projectsQ.error && <ErrorPanel>Error loading projects: {(projectsQ.error as Error).message}</ErrorPanel>}

      {projectsQ.data && (
        <Card padded={false}>
          {filtered.length === 0 ? (
            <EmptyState
              title={
                view === "hidden" ? "No hidden projects"
                : view === "unmapped" ? "No unmapped projects"
                : "No projects"
              }
              hint={
                view === "hidden" ? "Hide an unmapped project to see it appear here."
                : view === "unmapped" ? "Every project is mapped or hidden — nothing to triage."
                : undefined
              }
            />
          ) : (
            <table className="w-full text-[13px]">
              <thead style={{ background: "var(--color-surface-sunken)" }}>
                <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                  <th className="px-3 py-2.5 font-semibold w-[110px]">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Name</th>
                  <th className="px-3 py-2.5 font-semibold w-[110px]">Project No.</th>
                  <th className="px-3 py-2.5 font-semibold w-[200px]">Project ID</th>
                  <th className="px-3 py-2.5 font-semibold w-[110px]">SOS Number</th>
                  <th className="px-3 py-2.5 font-semibold">SHEQ Site Name</th>
                  <th className="px-3 py-2.5 font-semibold text-right w-[100px]">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <ProjectRow
                    key={p.dalux_project_id}
                    project={p}
                    busy={
                      (hideMutation.isPending && hideMutation.variables === p.dalux_project_id) ||
                      (unhideMutation.isPending && unhideMutation.variables === p.dalux_project_id)
                    }
                    onHide={() => hideMutation.mutate(p.dalux_project_id)}
                    onUnhide={() => unhideMutation.mutate(p.dalux_project_id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center px-3 py-1.5 rounded-full border text-[12.5px] font-medium transition-colors"
      style={
        active
          ? { background: "var(--color-brand-600)", color: "#fff", borderColor: "var(--color-brand-600)" }
          : { background: "var(--color-surface-raised)", color: "var(--color-text)", borderColor: "var(--color-border-strong)" }
      }
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: ProjectStatus }) {
  if (status === "mapped")   return <Tag tone="success">Mapped</Tag>;
  if (status === "unmapped") return <Tag tone="warning">Unmapped</Tag>;
  return <Tag tone="neutral">Hidden</Tag>;
}

function ProjectRow({
  project, busy, onHide, onUnhide,
}: {
  project: AdminProject;
  busy: boolean;
  onHide: () => void;
  onUnhide: () => void;
}) {
  return (
    <tr
      className="border-t hover:bg-[var(--color-surface-sunken)]"
      style={{ borderColor: "var(--color-border)" }}
    >
      <td className="px-3 py-2.5">
        <StatusPill status={project.status} />
      </td>
      <td className="px-3 py-2.5 font-medium" style={{ color: "var(--color-text)" }}>
        {project.dalux_project_name}
      </td>
      <td className="px-3 py-2.5 tabular" style={{ color: "var(--color-text-muted)" }}>
        {project.dalux_project_number || "—"}
      </td>
      <td
        className="px-3 py-2.5 tabular truncate max-w-[200px]"
        style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-faint)", fontSize: "11.5px" }}
        title={project.dalux_project_id}
      >
        {project.dalux_project_id}
      </td>
      <td className="px-3 py-2.5 tabular" style={{ color: "var(--color-text)" }}>
        {project.sos_number || "—"}
      </td>
      <td className="px-3 py-2.5" style={{ color: project.site_name ? "var(--color-text)" : "var(--color-text-faint)" }}>
        {project.site_name || "—"}
      </td>
      <td className="px-3 py-2.5 text-right">
        {project.status === "mapped" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled
            title="Mapped projects can't be hidden"
          >
            —
          </Button>
        ) : project.status === "hidden" ? (
          <Button size="sm" variant="secondary" onClick={onUnhide} disabled={busy}>
            {busy ? "…" : "Unhide"}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onHide} disabled={busy}>
            {busy ? "…" : "Hide"}
          </Button>
        )}
      </td>
    </tr>
  );
}
