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