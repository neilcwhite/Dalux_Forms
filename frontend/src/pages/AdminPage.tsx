import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchAdminProjects, hideProject, unhideProject,
  type AdminProject, type ProjectStatus,
  fetchTemplateVersions, fetchTemplateAudit, uploadTemplate,
  disableTemplateVersion, enableTemplateVersion, deleteTemplateVersion,
  type TemplateVersion, type TemplateAuditRow,
} from "../api";
import {
  Card, Tag, Button, PageHeader, LoadingPanel, ErrorPanel, EmptyState,
} from "../components/ui";

type Tab = "projects" | "templates";
const TABS: Tab[] = ["projects", "templates"];

export default function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: Tab = (TABS as string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "projects";

  function setTab(next: Tab) {
    const sp = new URLSearchParams(searchParams);
    sp.set("tab", next);
    // Reset sub-filters when switching tabs to avoid leaking state
    if (next === "projects") sp.delete("view");
    setSearchParams(sp);
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Admin"
        subtitle={
          tab === "projects"
            ? "Dalux project mapping status. Hide projects you don't need to see in the worklist."
            : "Upload and version custom report templates without redeploying the app."
        }
      />

      <div className="flex items-center gap-2 mb-4 border-b" style={{ borderColor: "var(--color-border)" }}>
        <TabButton active={tab === "projects"} onClick={() => setTab("projects")}>Projects</TabButton>
        <TabButton active={tab === "templates"} onClick={() => setTab("templates")}>Templates</TabButton>
      </div>

      {tab === "projects" ? <ProjectsTab /> : <TemplatesTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors"
      style={
        active
          ? { color: "var(--color-brand-600)", borderColor: "var(--color-brand-600)" }
          : { color: "var(--color-text-muted)", borderColor: "transparent" }
      }
    >
      {children}
    </button>
  );
}

// ===========================================================================
// Projects tab — existing functionality, unchanged
// ===========================================================================

type View = "unmapped" | "hidden" | "all";
const VIEWS: View[] = ["unmapped", "hidden", "all"];

function ProjectsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const rawView = searchParams.get("view");
  const view: View = (VIEWS as string[]).includes(rawView ?? "") ? (rawView as View) : "unmapped";

  function setView(next: View) {
    const sp = new URLSearchParams(searchParams);
    sp.set("view", next);
    setSearchParams(sp);
  }

  const projectsQ = useQuery({ queryKey: ["admin-projects"], queryFn: fetchAdminProjects });

  const hideMutation = useMutation({
    mutationFn: hideProject,
    onMutate: async (projectId: string) => {
      await queryClient.cancelQueries({ queryKey: ["admin-projects"] });
      const previous = queryClient.getQueryData<AdminProject[]>(["admin-projects"]);
      queryClient.setQueryData<AdminProject[]>(["admin-projects"], (rows) =>
        (rows ?? []).map(r => r.dalux_project_id === projectId ? { ...r, status: "hidden" as ProjectStatus } : r),
      );
      return { previous };
    },
    onError: (_e, _id, ctx) => { if (ctx?.previous) queryClient.setQueryData(["admin-projects"], ctx.previous); },
    onSettled: () => { queryClient.invalidateQueries({ queryKey: ["admin-projects"] }); },
  });

  const unhideMutation = useMutation({
    mutationFn: unhideProject,
    onMutate: async (projectId: string) => {
      await queryClient.cancelQueries({ queryKey: ["admin-projects"] });
      const previous = queryClient.getQueryData<AdminProject[]>(["admin-projects"]);
      queryClient.setQueryData<AdminProject[]>(["admin-projects"], (rows) =>
        (rows ?? []).map(r => {
          if (r.dalux_project_id !== projectId) return r;
          const restored: ProjectStatus = r.sos_number ? "mapped" : "unmapped";
          return { ...r, status: restored };
        }),
      );
      return { previous };
    },
    onError: (_e, _id, ctx) => { if (ctx?.previous) queryClient.setQueryData(["admin-projects"], ctx.previous); },
    onSettled: () => { queryClient.invalidateQueries({ queryKey: ["admin-projects"] }); },
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

  const mutationError = (hideMutation.error as Error | null)?.message ?? (unhideMutation.error as Error | null)?.message ?? null;

  return (
    <>
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

      {mutationError && <div className="mb-4"><ErrorPanel>Action failed: {mutationError}</ErrorPanel></div>}

      {projectsQ.isLoading && <LoadingPanel>Loading projects…</LoadingPanel>}
      {projectsQ.error && <ErrorPanel>Error loading projects: {(projectsQ.error as Error).message}</ErrorPanel>}

      {projectsQ.data && (
        <Card padded={false}>
          {filtered.length === 0 ? (
            <EmptyState
              title={view === "hidden" ? "No hidden projects" : view === "unmapped" ? "No unmapped projects" : "No projects"}
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
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center px-3 py-1.5 rounded-full border text-[12.5px] font-medium transition-colors"
      style={
        active
          ? { background: "var(--color-brand-600)", color: "#fff", borderColor: "var(--color-brand-600)" }
          : { background: "var(--color-surface-raised)", color: "var(--color-text)", borderColor: "var(--color-border-strong)" }
      }
    >{children}</button>
  );
}

function StatusPill({ status }: { status: ProjectStatus }) {
  if (status === "mapped")   return <Tag tone="success">Mapped</Tag>;
  if (status === "unmapped") return <Tag tone="warning">Unmapped</Tag>;
  return <Tag tone="neutral">Hidden</Tag>;
}

function ProjectRow({
  project, busy, onHide, onUnhide,
}: { project: AdminProject; busy: boolean; onHide: () => void; onUnhide: () => void }) {
  return (
    <tr className="border-t hover:bg-[var(--color-surface-sunken)]" style={{ borderColor: "var(--color-border)" }}>
      <td className="px-3 py-2.5"><StatusPill status={project.status} /></td>
      <td className="px-3 py-2.5 font-medium" style={{ color: "var(--color-text)" }}>{project.dalux_project_name}</td>
      <td className="px-3 py-2.5 tabular" style={{ color: "var(--color-text-muted)" }}>{project.dalux_project_number || "—"}</td>
      <td
        className="px-3 py-2.5 tabular truncate max-w-[200px]"
        style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-faint)", fontSize: "11.5px" }}
        title={project.dalux_project_id}
      >{project.dalux_project_id}</td>
      <td className="px-3 py-2.5 tabular" style={{ color: "var(--color-text)" }}>{project.sos_number || "—"}</td>
      <td className="px-3 py-2.5" style={{ color: project.site_name ? "var(--color-text)" : "var(--color-text-faint)" }}>{project.site_name || "—"}</td>
      <td className="px-3 py-2.5 text-right">
        {project.status === "mapped" ? (
          <Button size="sm" variant="ghost" disabled title="Mapped projects can't be hidden">—</Button>
        ) : project.status === "hidden" ? (
          <Button size="sm" variant="secondary" onClick={onUnhide} disabled={busy}>{busy ? "…" : "Unhide"}</Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onHide} disabled={busy}>{busy ? "…" : "Hide"}</Button>
        )}
      </td>
    </tr>
  );
}

// ===========================================================================
// Templates tab — upload form, version table, recent audit
// ===========================================================================

const TOKEN_STORAGE_KEY = "dalux:admin-upload-token";

function TemplatesTab() {
  const queryClient = useQueryClient();
  const versionsQ = useQuery({ queryKey: ["admin-templates"], queryFn: fetchTemplateVersions });
  const auditQ = useQuery({ queryKey: ["admin-templates-audit"], queryFn: () => fetchTemplateAudit(20) });

  const [adminToken, setAdminToken] = useState<string>(() => localStorage.getItem(TOKEN_STORAGE_KEY) ?? "");
  function persistToken(value: string) {
    setAdminToken(value);
    if (value) localStorage.setItem(TOKEN_STORAGE_KEY, value);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  const uploadMutation = useMutation({
    mutationFn: ({ py, j2 }: { py: File; j2: File }) => uploadTemplate(py, j2, adminToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-templates"] });
      queryClient.invalidateQueries({ queryKey: ["admin-templates-audit"] });
      queryClient.invalidateQueries({ queryKey: ["form-types"] });
    },
  });

  const disableMut = useMutation({
    mutationFn: ({ form_code, version }: { form_code: string; version: number }) =>
      disableTemplateVersion(form_code, version, adminToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-templates"] });
      queryClient.invalidateQueries({ queryKey: ["admin-templates-audit"] });
    },
  });
  const enableMut = useMutation({
    mutationFn: ({ form_code, version }: { form_code: string; version: number }) =>
      enableTemplateVersion(form_code, version, adminToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-templates"] });
      queryClient.invalidateQueries({ queryKey: ["admin-templates-audit"] });
    },
  });
  const deleteMut = useMutation({
    mutationFn: ({ form_code, version }: { form_code: string; version: number }) =>
      deleteTemplateVersion(form_code, version, adminToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-templates"] });
      queryClient.invalidateQueries({ queryKey: ["admin-templates-audit"] });
    },
  });

  return (
    <div className="grid grid-cols-1 gap-5">
      <UploadForm
        adminToken={adminToken}
        onTokenChange={persistToken}
        uploading={uploadMutation.isPending}
        result={uploadMutation.data}
        error={uploadMutation.error as Error | null}
        onUpload={(py, j2) => uploadMutation.mutate({ py, j2 })}
        onClear={() => uploadMutation.reset()}
      />

      <VersionsTable
        versions={versionsQ.data}
        loading={versionsQ.isLoading}
        error={versionsQ.error as Error | null}
        adminTokenSet={Boolean(adminToken)}
        onDisable={(form_code, version) => disableMut.mutate({ form_code, version })}
        onEnable={(form_code, version) => enableMut.mutate({ form_code, version })}
        onDelete={(form_code, version) => {
          if (window.confirm(`Permanently delete ${form_code} v${version}? Files will be removed from the server.`)) {
            deleteMut.mutate({ form_code, version });
          }
        }}
        busyKey={
          disableMut.isPending ? `${disableMut.variables?.form_code}-${disableMut.variables?.version}-d`
          : enableMut.isPending ? `${enableMut.variables?.form_code}-${enableMut.variables?.version}-e`
          : deleteMut.isPending ? `${deleteMut.variables?.form_code}-${deleteMut.variables?.version}-x`
          : null
        }
      />

      <AuditList rows={auditQ.data ?? []} loading={auditQ.isLoading} />
    </div>
  );
}

function UploadForm({
  adminToken, onTokenChange, uploading, result, error, onUpload, onClear,
}: {
  adminToken: string;
  onTokenChange: (v: string) => void;
  uploading: boolean;
  result?: { form_code: string; version: number; valid_from: string; source: string; form_display: string };
  error: Error | null;
  onUpload: (py: File, j2: File) => void;
  onClear: () => void;
}) {
  const pyRef = useRef<HTMLInputElement>(null);
  const j2Ref = useRef<HTMLInputElement>(null);
  const [pyFile, setPyFile] = useState<File | null>(null);
  const [j2File, setJ2File] = useState<File | null>(null);
  const [showToken, setShowToken] = useState(false);

  // Reset file inputs after a successful upload so the form is ready for next.
  useEffect(() => {
    if (result) {
      setPyFile(null);
      setJ2File(null);
      if (pyRef.current) pyRef.current.value = "";
      if (j2Ref.current) j2Ref.current.value = "";
    }
  }, [result]);

  const canSubmit = !!pyFile && !!j2File && !!adminToken && !uploading;
  const errorDetail = (error as { response?: { data?: { detail?: string } } } | null)?.response?.data?.detail;

  return (
    <Card>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[14px] font-semibold">Upload new template version</h2>
        <span className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
          .py + .html.j2 pair, validated and registered live
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-3">
        <FileSlot
          label="Python builder (.py)"
          inputRef={pyRef}
          accept=".py"
          file={pyFile}
          onChange={setPyFile}
        />
        <FileSlot
          label="Jinja template (.html.j2)"
          inputRef={j2Ref}
          accept=".j2,.html"
          file={j2File}
          onChange={setJ2File}
        />
      </div>

      <div className="mb-3">
        <Label>Admin token <span style={{ color: "var(--color-text-faint)" }}>(stored in this browser)</span></Label>
        <div className="flex items-center gap-2">
          <input
            type={showToken ? "text" : "password"}
            value={adminToken}
            onChange={e => onTokenChange(e.target.value)}
            placeholder="X-Admin-Token value"
            className="flex-1 px-2.5 py-1.5 text-[13px] rounded border outline-none focus:border-[var(--color-brand-500)]"
            style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border-strong)", color: "var(--color-text)" }}
          />
          <Button size="sm" variant="ghost" onClick={() => setShowToken(s => !s)}>
            {showToken ? "Hide" : "Show"}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={!canSubmit}
          onClick={() => { if (pyFile && j2File) onUpload(pyFile, j2File); }}
        >
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        {(result || error) && (
          <Button variant="ghost" size="sm" onClick={onClear}>Clear result</Button>
        )}
      </div>

      {result && (
        <div className="mt-3 p-3 rounded border text-[12.5px]"
             style={{ background: "var(--color-success-50)", color: "var(--color-success-700)", borderColor: "var(--color-success-200)" }}>
          ✓ Registered <strong>{result.form_code} v{result.version}</strong> ({result.form_display}) — valid from {result.valid_from}.
        </div>
      )}
      {error && (
        <div className="mt-3"><ErrorPanel>{errorDetail ?? error.message}</ErrorPanel></div>
      )}
    </Card>
  );
}

function FileSlot({
  label, inputRef, accept, file, onChange,
}: {
  label: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded border text-[12.5px]"
        style={{ background: "var(--color-surface-sunken)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={e => onChange(e.target.files?.[0] ?? null)}
          className="flex-1 min-w-0 text-[12px]"
        />
        {file && <Tag tone="neutral">{Math.round(file.size / 1024)} KB</Tag>}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--color-text-faint)" }}>{children}</div>;
}

function VersionsTable({
  versions, loading, error, adminTokenSet, onDisable, onEnable, onDelete, busyKey,
}: {
  versions?: TemplateVersion[];
  loading: boolean;
  error: Error | null;
  adminTokenSet: boolean;
  onDisable: (form_code: string, version: number) => void;
  onEnable: (form_code: string, version: number) => void;
  onDelete: (form_code: string, version: number) => void;
  busyKey: string | null;
}) {
  if (loading) return <LoadingPanel>Loading templates…</LoadingPanel>;
  if (error) return <ErrorPanel>Error loading templates: {error.message}</ErrorPanel>;
  const rows = versions ?? [];

  return (
    <Card padded={false}>
      <div className="flex items-baseline justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="text-[14px] font-semibold">Installed templates</h2>
        <span className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          {rows.length} version{rows.length === 1 ? "" : "s"} across {new Set(rows.map(r => r.form_code)).size} form codes
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No templates registered" />
      ) : (
        <table className="w-full text-[13px]">
          <thead style={{ background: "var(--color-surface-sunken)" }}>
            <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
              <th className="px-3 py-2.5 font-semibold w-[90px]">Code</th>
              <th className="px-3 py-2.5 font-semibold w-[60px]">Version</th>
              <th className="px-3 py-2.5 font-semibold w-[90px]">Source</th>
              <th className="px-3 py-2.5 font-semibold w-[110px]">Valid from</th>
              <th className="px-3 py-2.5 font-semibold">Display name</th>
              <th className="px-3 py-2.5 font-semibold w-[80px]">Status</th>
              <th className="px-3 py-2.5 font-semibold text-right w-[180px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(v => {
              const key = `${v.form_code}-${v.version}`;
              const disabling = busyKey === `${key}-d`;
              const enabling = busyKey === `${key}-e`;
              const deleting = busyKey === `${key}-x`;
              const busy = disabling || enabling || deleting;
              return (
                <tr key={key} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <td className="px-3 py-2.5 font-mono font-medium" style={{ color: "var(--color-text)" }}>{v.form_code}</td>
                  <td className="px-3 py-2.5 tabular" style={{ color: "var(--color-text)" }}>v{v.version}</td>
                  <td className="px-3 py-2.5">
                    {v.source === "builtin" ? <Tag tone="brand">Built-in</Tag> : <Tag tone="info">Uploaded</Tag>}
                  </td>
                  <td className="px-3 py-2.5 tabular" style={{ color: "var(--color-text-muted)" }}>
                    {v.source === "builtin" ? "—" : v.valid_from}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: "var(--color-text)" }}>{v.form_display}</td>
                  <td className="px-3 py-2.5">
                    {v.disabled ? <Tag tone="warning">Disabled</Tag> : <Tag tone="success">Active</Tag>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {v.source === "builtin" ? (
                      <span className="text-[11.5px]" style={{ color: "var(--color-text-faint)" }}>locked</span>
                    ) : !adminTokenSet ? (
                      <span className="text-[11.5px]" style={{ color: "var(--color-text-faint)" }} title="Enter admin token above">no token</span>
                    ) : v.disabled ? (
                      <div className="inline-flex gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => onEnable(v.form_code, v.version)} disabled={busy}>
                          {enabling ? "…" : "Enable"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onDelete(v.form_code, v.version)} disabled={busy}>
                          {deleting ? "…" : "Delete"}
                        </Button>
                      </div>
                    ) : (
                      <div className="inline-flex gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => onDisable(v.form_code, v.version)} disabled={busy}>
                          {disabling ? "…" : "Disable"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onDelete(v.form_code, v.version)} disabled={busy}>
                          {deleting ? "…" : "Delete"}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function AuditList({ rows, loading }: { rows: TemplateAuditRow[]; loading: boolean }) {
  return (
    <Card padded={false}>
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="text-[14px] font-semibold">Recent activity</h2>
        <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>Last 20 upload / disable / enable / delete events</div>
      </div>
      {loading ? <LoadingPanel>Loading…</LoadingPanel> : rows.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <table className="w-full text-[12.5px]">
          <thead style={{ background: "var(--color-surface-sunken)" }}>
            <tr className="text-left text-[10px] uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
              <th className="px-3 py-2 font-semibold w-[160px]">When</th>
              <th className="px-3 py-2 font-semibold w-[90px]">Code</th>
              <th className="px-3 py-2 font-semibold w-[60px]">Version</th>
              <th className="px-3 py-2 font-semibold w-[100px]">Outcome</th>
              <th className="px-3 py-2 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                <td className="px-3 py-2 tabular" style={{ color: "var(--color-text-muted)" }}>
                  {new Date(r.uploaded_at).toLocaleString("en-GB")}
                </td>
                <td className="px-3 py-2 font-mono">{r.form_code}</td>
                <td className="px-3 py-2 tabular">{r.version != null ? `v${r.version}` : "—"}</td>
                <td className="px-3 py-2">
                  {r.outcome === "registered" && <Tag tone="success">registered</Tag>}
                  {r.outcome === "rejected"   && <Tag tone="danger">rejected</Tag>}
                  {r.outcome === "disabled"   && <Tag tone="warning">disabled</Tag>}
                  {r.outcome === "enabled"    && <Tag tone="info">enabled</Tag>}
                  {r.outcome === "deleted"    && <Tag tone="neutral">deleted</Tag>}
                </td>
                <td className="px-3 py-2 truncate max-w-[400px]" style={{ color: "var(--color-text-muted)" }} title={r.error_message ?? ""}>
                  {r.error_message ?? (r.uploader_ip ? `from ${r.uploader_ip}` : "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
