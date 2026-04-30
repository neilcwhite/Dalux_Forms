import { useEffect, useState } from "react";

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
      {/* Search */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded text-[13px] w-80 max-w-[40%]"
        style={{ background: "var(--color-surface-sunken)", color: "var(--color-text-muted)" }}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m11 11 3 3" />
        </svg>
        <span className="flex-1">Search forms, sites, templates…</span>
        <kbd
          className="px-1.5 py-0.5 rounded text-[10px] font-mono"
          style={{ background: "var(--color-surface-raised)", border: "1px solid var(--color-border)" }}
        >
          ⌘K
        </kbd>
      </div>

      <div className="flex-1" />

      {/* Sync status */}
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[12px]"
        style={{ background: "var(--color-success-50)", color: "var(--color-success-700)" }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success-500)] animate-pulse" />
        Synced · 12 min ago
      </div>

      {/* Theme toggle */}
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

      {/* Help */}
      <button
        className="h-8 w-8 grid place-items-center rounded hover:bg-[var(--color-surface-sunken)]"
        title="Help"
        style={{ color: "var(--color-text-muted)" }}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
          <circle cx="10" cy="10" r="7" />
          <path d="M8 8a2 2 0 1 1 3.2 1.6c-.7.5-1.2 1-1.2 1.9M10 14h.01" />
        </svg>
      </button>
    </header>
  );
}
