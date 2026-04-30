import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchSearch, fetchSyncStatus, changePassword, type SearchResponse } from "../api";
import { useAuth } from "../auth/AuthContext";

export default function TopBar() {
  const [mode, setMode] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("dalux:mode");
    return saved === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    localStorage.setItem("dalux:mode", mode);
  }, [mode]);

  return (
    <header
      className="h-14 shrink-0 flex items-center gap-3 px-5 border-b"
      style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)" }}
    >
      <SearchBox />

      <div className="flex-1" />

      <SyncIndicator />

      <button
        onClick={() => setMode(m => (m === "dark" ? "light" : "dark"))}
        className="h-8 w-8 grid place-items-center rounded hover:bg-[var(--color-surface-sunken)]"
        title={mode === "dark" ? "Switch to light" : "Switch to dark"}
        style={{ color: "var(--color-text-muted)" }}
      >
        {mode === "dark" ? (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
            <circle cx="10" cy="10" r="3.5" />
            <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.4 4.4l1.4 1.4M14.2 14.2l1.4 1.4M4.4 15.6l1.4-1.4M14.2 5.8l1.4-1.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M14.5 11.5A5.5 5.5 0 0 1 8.5 5.5c0-.7.13-1.37.37-2A6.5 6.5 0 1 0 16.5 11.13c-.63.24-1.3.37-2 .37Z" />
          </svg>
        )}
      </button>

      <UserMenu />
    </header>
  );
}

// ---------------------------------------------------------------------------
// UserMenu — current user pill with logout + change-password
// ---------------------------------------------------------------------------

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [showPwModal, setShowPwModal] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  if (!user) return null;
  const initials = (user.name || user.email).split(/\s+|[._]/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join("");

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="h-8 inline-flex items-center gap-2 px-2 rounded hover:bg-[var(--color-surface-sunken)] transition-colors"
        title={user.email}
      >
        <span
          className="h-7 w-7 rounded-full text-[11px] font-semibold grid place-items-center"
          style={{ background: "var(--color-brand-600)", color: "#fff" }}
        >
          {initials || "?"}
        </span>
        <span className="text-[12.5px] font-medium hidden md:inline" style={{ color: "var(--color-text)" }}>
          {user.name || user.email.split("@")[0]}
        </span>
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: "var(--color-text-muted)" }}>
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 min-w-[220px] rounded border shadow-lg z-50 overflow-hidden"
          style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)" }}
        >
          <div className="px-3 py-2.5 border-b" style={{ borderColor: "var(--color-border)" }}>
            <div className="text-[12.5px] font-semibold truncate">{user.name || "(no display name)"}</div>
            <div className="text-[11px] truncate" style={{ color: "var(--color-text-muted)" }}>{user.email}</div>
            <div className="text-[10.5px] mt-0.5 inline-block px-1.5 py-0.5 rounded font-semibold" style={{ background: "var(--color-brand-50)", color: "var(--color-brand-700)" }}>
              {user.role}
            </div>
          </div>
          <MenuItem onClick={() => { setOpen(false); setShowPwModal(true); }}>Change password</MenuItem>
          <MenuItem onClick={() => { setOpen(false); signOut(); }} tone="danger">Sign out</MenuItem>
        </div>
      )}

      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}
    </div>
  );
}

function MenuItem({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone?: "danger" }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-[var(--color-surface-sunken)]"
      style={{ color: tone === "danger" ? "var(--color-danger-700)" : "var(--color-text)" }}
    >
      {children}
    </button>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!user) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next !== confirm) {
      setErr("New passwords don't match.");
      return;
    }
    if (next.length < 4) {
      setErr("New password must be at least 4 characters.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(user!.email, current, next);
      setDone(true);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } } | null)?.response?.data?.detail;
      setErr(typeof detail === "string" ? detail : "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center"
      style={{ background: "rgba(15, 27, 45, 0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm p-5 rounded border"
        style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)" }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold mb-1">Change password</h2>
        <p className="text-[12px] mb-4" style={{ color: "var(--color-text-muted)" }}>{user.email}</p>

        {done ? (
          <>
            <div
              className="px-3 py-2 rounded text-[12.5px] mb-4 border"
              style={{ background: "var(--color-success-50)", color: "var(--color-success-700)", borderColor: "var(--color-success-200)" }}
            >
              ✓ Password changed.
            </div>
            <button
              onClick={onClose}
              className="w-full px-3 py-2 rounded text-[13px] font-semibold"
              style={{ background: "var(--color-brand-600)", color: "#fff" }}
            >Close</button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <PwField label="Current password" value={current} onChange={setCurrent} autoFocus />
            <PwField label="New password" value={next} onChange={setNext} />
            <PwField label="Confirm new password" value={confirm} onChange={setConfirm} />
            {err && (
              <div
                className="px-3 py-2 rounded text-[12px] border"
                style={{ background: "var(--color-danger-50)", color: "var(--color-danger-700)", borderColor: "var(--color-danger-200)" }}
              >{err}</div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 rounded text-[12.5px]"
                style={{ background: "transparent", color: "var(--color-text-muted)" }}
              >Cancel</button>
              <button
                type="submit"
                disabled={busy || !current || !next || !confirm}
                className="px-3 py-2 rounded text-[12.5px] font-semibold disabled:opacity-60"
                style={{ background: "var(--color-brand-600)", color: "#fff" }}
              >{busy ? "Saving…" : "Change password"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function PwField({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="block">
      <div className="text-[10.5px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--color-text-faint)" }}>{label}</div>
      <input
        type="password"
        autoFocus={autoFocus}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 text-[13px] rounded border outline-none focus:border-[var(--color-brand-500)]"
        style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border-strong)", color: "var(--color-text)" }}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// SearchBox — debounced query, dropdown of categorised hits, Ctrl+K to focus.
// ---------------------------------------------------------------------------

function SearchBox() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce typing
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  // Ctrl+K (Cmd+K on Mac too, but the visible hint is Windows)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes the dropdown
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const searchQ = useQuery({
    queryKey: ["search", debouncedQ],
    queryFn: () => fetchSearch(debouncedQ),
    enabled: debouncedQ.length >= 2,
    staleTime: 30_000,
  });

  const totalHits = useMemo(() => {
    const r = searchQ.data;
    if (!r) return 0;
    return r.sites.length + r.forms.length + r.templates.length;
  }, [searchQ.data]);

  function handlePick(target: string) {
    setOpen(false);
    setQ("");
    navigate(target);
  }

  return (
    <div ref={containerRef} className="relative w-80 max-w-[40%]">
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded text-[13px]"
        style={{
          background: "var(--color-surface-sunken)",
          color: "var(--color-text-muted)",
          outline: open ? "2px solid var(--color-brand-500)" : "none",
        }}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m11 11 3 3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search forms, sites, templates…"
          className="flex-1 bg-transparent outline-none placeholder:text-[var(--color-text-faint)]"
          style={{ color: "var(--color-text)" }}
        />
        <kbd
          className="px-1.5 py-0.5 rounded text-[10px] tracking-wide"
          style={{
            background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          Ctrl K
        </kbd>
      </div>

      {open && debouncedQ.length >= 2 && (
        <div
          className="absolute left-0 right-0 mt-1 rounded border shadow-lg overflow-hidden z-50"
          style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)" }}
        >
          {searchQ.isLoading && (
            <div className="px-3 py-3 text-[12px]" style={{ color: "var(--color-text-muted)" }}>Searching…</div>
          )}
          {searchQ.data && totalHits === 0 && !searchQ.isLoading && (
            <div className="px-3 py-3 text-[12px]" style={{ color: "var(--color-text-faint)" }}>
              No matches for "{debouncedQ}".
            </div>
          )}
          {searchQ.data && totalHits > 0 && (
            <SearchResults data={searchQ.data} onPick={handlePick} />
          )}
        </div>
      )}
      {open && debouncedQ.length > 0 && debouncedQ.length < 2 && (
        <div
          className="absolute left-0 right-0 mt-1 rounded border px-3 py-2 text-[11.5px] z-50"
          style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)", color: "var(--color-text-faint)" }}
        >
          Type at least 2 characters
        </div>
      )}
    </div>
  );
}

function SearchResults({
  data, onPick,
}: { data: SearchResponse; onPick: (target: string) => void }) {
  return (
    <div className="max-h-[440px] overflow-auto">
      {data.sites.length > 0 && (
        <Group title="Sites">
          {data.sites.map(s => (
            <button
              key={s.dalux_id ?? s.sos_number}
              onClick={() => s.sos_number && onPick(`/sites/${s.sos_number}`)}
              disabled={!s.sos_number}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-[var(--color-surface-sunken)] disabled:opacity-50"
            >
              <Pill mono>{s.sos_number ?? "—"}</Pill>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{s.site_name || s.sos_name || "(unnamed)"}</div>
                <div className="text-[11px] truncate" style={{ color: "var(--color-text-faint)" }}>
                  {[s.sector, s.client].filter(Boolean).join(" · ")}
                </div>
              </div>
            </button>
          ))}
        </Group>
      )}
      {data.forms.length > 0 && (
        <Group title="Forms">
          {data.forms.map(f => (
            <button
              key={f.formId}
              onClick={() => onPick(`/forms?form_type=${encodeURIComponent(f.template_name)}`)}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-[var(--color-surface-sunken)]"
            >
              <Pill mono>{f.number ?? f.formId.slice(0, 8)}</Pill>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{f.template_name}</div>
                <div className="text-[11px] truncate" style={{ color: "var(--color-text-faint)" }}>
                  {f.sos_number && `${f.sos_number} · `}{f.site_display ?? ""} · {f.status}
                </div>
              </div>
            </button>
          ))}
        </Group>
      )}
      {data.templates.length > 0 && (
        <Group title="Templates">
          {data.templates.map(t => (
            <button
              key={t.template_name}
              onClick={() => onPick(`/forms?form_type=${encodeURIComponent(t.template_name)}`)}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-[var(--color-surface-sunken)]"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{t.template_name}</div>
                <div className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
                  {t.form_count} form{t.form_count === 1 ? "" : "s"}
                </div>
              </div>
            </button>
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold border-b"
        style={{
          background: "var(--color-surface-sunken)",
          color: "var(--color-text-faint)",
          borderColor: "var(--color-border)",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Pill({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span
      className="shrink-0 px-1.5 py-0.5 rounded text-[10.5px] font-semibold tabular"
      style={{
        background: "var(--color-brand-50)",
        color: "var(--color-brand-700)",
        fontFamily: mono ? "var(--font-mono)" : undefined,
      }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SyncIndicator — real "last synced" pill, refetches every 60s.
// ---------------------------------------------------------------------------

function SyncIndicator() {
  const statusQ = useQuery({
    queryKey: ["sync-status"],
    queryFn: fetchSyncStatus,
    refetchInterval: 60_000,
    staleTime: 50_000,
  });

  // Re-render every 60s so relative time stays fresh even if the data hasn't changed
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const status = statusQ.data;
  const lastIso = status?.last_synced_at ?? null;
  const ageMin = lastIso ? Math.max(0, Math.round((Date.now() - new Date(lastIso).getTime()) / 60_000)) : null;

  // Threshold: green < 90 min (n8n is hourly), amber 90–180 min, red ≥ 180 min
  let tone: "ok" | "warn" | "err" | "neutral" = "neutral";
  if (status === undefined) tone = "neutral";
  else if (ageMin === null || !status.ok) tone = "err";
  else if (ageMin < 90) tone = "ok";
  else if (ageMin < 180) tone = "warn";
  else tone = "err";

  const palette: Record<typeof tone, { bg: string; fg: string; dot: string }> = {
    ok:      { bg: "var(--color-success-50)", fg: "var(--color-success-700)", dot: "var(--color-success-500)" },
    warn:    { bg: "var(--color-warning-50)", fg: "var(--color-warning-700)", dot: "var(--color-warning-500)" },
    err:     { bg: "var(--color-danger-50)",  fg: "var(--color-danger-700)",  dot: "var(--color-danger-500)" },
    neutral: { bg: "var(--color-surface-sunken)", fg: "var(--color-text-muted)", dot: "var(--color-text-faint)" },
  };
  const p = palette[tone];

  let label: string;
  if (status === undefined) label = "Checking sync…";
  else if (ageMin === null) label = "Sync status unknown";
  else if (ageMin < 1) label = "Synced just now";
  else if (ageMin < 60) label = `Synced · ${ageMin} min ago`;
  else if (ageMin < 60 * 24) label = `Synced · ${Math.round(ageMin / 60)}h ago`;
  else label = `Synced · ${Math.round(ageMin / (60 * 24))}d ago`;

  const tooltip = lastIso
    ? `Last successful Dalux sync: ${new Date(lastIso).toLocaleString("en-GB")}`
    : "No sync record found";

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[12px]"
      style={{ background: p.bg, color: p.fg }}
      title={tooltip}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${tone === "ok" ? "animate-pulse" : ""}`}
        style={{ background: p.dot }}
      />
      {label}
    </div>
  );
}
