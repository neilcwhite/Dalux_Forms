import axios from "axios";

export const api = axios.create({
  baseURL: "",
  timeout: 30000,
  paramsSerializer: { indexes: null },
});

export interface Site {
  dalux_id: string;
  dalux_name: string;
  dalux_number: string | null;
  sos_number: string | null;
  site_name: string | null;
  client: string | null;
  sector: string | null;
  sheq_status: string | null;
  dalux_active: string | null;
  is_mapped: 0 | 1;
}

export interface FormType {
  template_name: string;
  display_name: string;
  type: string;
  form_count: number;
  first_seen: string;
  last_modified: string;
  has_custom_report: boolean;
}

export interface FormRow {
  formId: string;
  projectId: string;
  type: string;
  number: string | null;
  template_name: string;
  status: string;
  created: string;
  modified: string;
  createdBy_userId: string | null;
  creator_name: string | null;
  site_display: string | null;
  sos_number: string | null;
  is_mapped: 0 | 1;
  last_downloaded_at: string | null;
  download_count: number;
  modified_since_download: boolean;
  has_custom_report: boolean;
}

export interface FormsResponse {
  count: number;
  limit: number;
  filters: Record<string, unknown>;
  forms: FormRow[];
}

export async function fetchSites(): Promise<Site[]> {
  const { data } = await api.get<Site[]>("/api/sites");
  return data;
}

export interface SiteTemplateSummary {
  template_name: string;
  short_code: string;
  count: number;
}

export interface SiteFormSummaryEntry {
  templates: SiteTemplateSummary[];
  total_forms: number;
  undownloaded_forms: number;
  stale_undownloaded: number;
}

export type SiteFormSummary = Record<string, SiteFormSummaryEntry>;

export async function fetchSiteFormSummary(formType?: string): Promise<SiteFormSummary> {
  const { data } = await api.get<SiteFormSummary>("/api/sites/form-summary", {
    params: formType ? { form_type: formType } : undefined,
  });
  return data;
}

export async function fetchFormTypes(): Promise<FormType[]> {
  const { data } = await api.get<FormType[]>("/api/form-types");
  return data;
}

export async function fetchForms(params: {
  site_id?: string[];
  form_type?: string;
  date_from?: string;
  date_to?: string;
  status?: string;
  not_downloaded_only?: boolean;
  limit?: number;
}): Promise<FormsResponse> {
  const { data } = await api.get<FormsResponse>("/api/forms", { params });
  return data;
}

// --- Admin -----------------------------------------------------------------

export type ProjectStatus = "mapped" | "unmapped" | "hidden";

export interface AdminProject {
  dalux_project_id: string;
  dalux_project_name: string;
  dalux_project_number: string | null;
  sos_number: string | null;
  site_name: string | null;
  status: ProjectStatus;
}

export async function fetchAdminProjects(): Promise<AdminProject[]> {
  const { data } = await api.get<AdminProject[]>("/api/admin/projects");
  return data;
}

export async function hideProject(daluxProjectId: string): Promise<{ hidden: true }> {
  const { data } = await api.post<{ hidden: true }>(
    `/api/admin/projects/${encodeURIComponent(daluxProjectId)}/hide`,
  );
  return data;
}

export async function unhideProject(daluxProjectId: string): Promise<{ hidden: false }> {
  const { data } = await api.post<{ hidden: false }>(
    `/api/admin/projects/${encodeURIComponent(daluxProjectId)}/unhide`,
  );
  return data;
}

// --- Admin: template upload ---------------------------------------------

export type TemplateSource = "builtin" | "uploaded";

export interface TemplateVersion {
  form_code: string;
  version: number;
  source: TemplateSource;
  valid_from: string;            // ISO date
  dalux_template_name: string;
  form_display: string;
  disabled: boolean;
  uploaded_at: string | null;
  python_sha256: string | null;
  template_sha256: string | null;
}

export interface TemplateAuditRow {
  id: number;
  uploaded_at: string;
  form_code: string;
  version: number | null;
  valid_from: string | null;
  outcome: "registered" | "rejected" | "disabled" | "enabled" | "deleted";
  error_message: string | null;
  uploader_ip: string | null;
  python_sha256: string | null;
  template_sha256: string | null;
}

export async function fetchTemplateVersions(): Promise<TemplateVersion[]> {
  const { data } = await api.get<TemplateVersion[]>("/api/admin/templates");
  return data;
}

export async function fetchTemplateAudit(limit = 50): Promise<TemplateAuditRow[]> {
  const { data } = await api.get<TemplateAuditRow[]>("/api/admin/templates/audit", {
    params: { limit },
  });
  return data;
}

export async function uploadTemplate(
  pythonFile: File,
  templateFile: File,
  adminToken: string,
): Promise<{ form_code: string; version: number; valid_from: string; source: string; form_display: string }> {
  const form = new FormData();
  form.append("python_file", pythonFile);
  form.append("template_file", templateFile);
  const { data } = await api.post("/api/admin/templates/upload", form, {
    headers: { "X-Admin-Token": adminToken },
  });
  return data;
}

export async function disableTemplateVersion(formCode: string, version: number, adminToken: string) {
  const { data } = await api.post(
    `/api/admin/templates/${encodeURIComponent(formCode)}/v${version}/disable`,
    null,
    { headers: { "X-Admin-Token": adminToken } },
  );
  return data;
}

export async function enableTemplateVersion(formCode: string, version: number, adminToken: string) {
  const { data } = await api.post(
    `/api/admin/templates/${encodeURIComponent(formCode)}/v${version}/enable`,
    null,
    { headers: { "X-Admin-Token": adminToken } },
  );
  return data;
}

export async function deleteTemplateVersion(formCode: string, version: number, adminToken: string) {
  const { data } = await api.delete(
    `/api/admin/templates/${encodeURIComponent(formCode)}/v${version}`,
    { headers: { "X-Admin-Token": adminToken } },
  );
  return data;
}

// --- Dashboard --------------------------------------------------------------

export type DashboardRange = "7d" | "30d" | "90d" | "1y" | "all";

export interface DashboardSector {
  name: string;
  sites: number;
  active: number;
  dormant: number;
  total: number;
  downloaded: number;
  pending: number;
  stale: number;
  trend: number[];
}

export interface DashboardAttentionRow {
  dalux_id: string;
  sos_number: string | null;
  site_name: string;
  sector: string;
  total: number;
  downloaded: number;
  pending: number;
  stale: number;
  pct: number;
}

export interface DashboardGroupResponse {
  range: DashboardRange;
  sectors: DashboardSector[];
  attention: DashboardAttentionRow[];
}

export async function fetchDashboardGroup(range: DashboardRange = "90d"): Promise<DashboardGroupResponse> {
  const { data } = await api.get<DashboardGroupResponse>("/api/dashboard/group", { params: { range } });
  return data;
}

export interface DashboardSectorDetailed extends DashboardSector {
  open_to_closed_days: number | null;
  closed_to_dl_days: number | null;
  coverage: number;
  top_project: string | null;
  top_project_forms: number;
  top_templates: { name: string; count: number }[];
}

export interface DashboardSectorsResponse {
  range: DashboardRange;
  sectors: DashboardSectorDetailed[];
}

export async function fetchDashboardSectors(range: DashboardRange = "90d"): Promise<DashboardSectorsResponse> {
  const { data } = await api.get<DashboardSectorsResponse>("/api/dashboard/sectors", { params: { range } });
  return data;
}

export interface ProjectDashboardSite {
  sos_number: string | null;
  dalux_id: string | null;
  name: string;
  sector: string;
  client: string | null;
  status: string;
  primary_contact: string | null;
  start_on_site_date: string | null;
  finish_on_site_date: string | null;
}

export interface ProjectDashboardResponse {
  site: ProjectDashboardSite;
  range: DashboardRange;
  daily: number[];
  total: number;
  downloaded: number;
  pending: number;
  stale: number;
  open_to_closed_days: number | null;
  closed_to_dl_days: number | null;
  templates: { name: string; count: number }[];
  contributors: { name: string; role: string | null; forms: number }[];
  recent: {
    form_id: string;
    number: string;
    template: string;
    by: string;
    when_iso: string | null;
    status: string;
  }[];
}

export async function fetchProjectDashboard(sosNumber: string, range: DashboardRange = "30d"): Promise<ProjectDashboardResponse> {
  const { data } = await api.get<ProjectDashboardResponse>(
    `/api/dashboard/projects/${encodeURIComponent(sosNumber)}`,
    { params: { range } },
  );
  return data;
}

export interface ActivityEvent {
  kind: "form_created" | "download" | "bulk_download" | string;
  icon: string;
  tone: "ok" | "warn" | "info" | "err" | string;
  at: string | null;
  text: string;
  form_id: string | null;
  sos_number: string | null;
}

export interface ActivityResponse {
  since: string;
  events: ActivityEvent[];
}

export async function fetchActivity(since: "24h" | "7d" | "30d" = "24h", limit = 20): Promise<ActivityResponse> {
  const { data } = await api.get<ActivityResponse>("/api/activity", { params: { since, limit } });
  return data;
}