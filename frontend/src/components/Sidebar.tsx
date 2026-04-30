import { NavLink, useLocation } from "react-router-dom";
import logo from "../assets/spencer-logo.png";

const primaryNav = [
  { to: "/dashboard", label: "Dashboard", icon: IconDashboard },
  { to: "/metrics",   label: "Metrics",   icon: IconMetrics },
  { to: "/forms",     label: "Forms",     icon: IconForms },
  { to: "/sites",     label: "Sites",     icon: IconSites },
];

// Admin nav: Admin links to the Projects tab; Templates links straight into
// the Templates tab on the same page. Both share /admin so we use a custom
// active rule (matchTab) to highlight only the one matching the current
// ?tab= query param — without it both would highlight on /admin.
const adminNav = [
  { to: "/admin",                 label: "Admin",     icon: IconAdmin,    matchTab: "projects" },
  { to: "/admin?tab=templates",   label: "Templates", icon: IconTemplate, matchTab: "templates" },
  { to: "/settings",              label: "Settings",  icon: IconCog,      disabled: true },
  { to: "/audit",                 label: "Audit log", icon: IconLog,      disabled: true },
];

export default function Sidebar() {
  return (
    <aside
      className="w-60 shrink-0 flex flex-col text-[13px]"
      style={{ background: "var(--color-sidebar)", color: "var(--color-sidebar-text)" }}
    >
      {/* Brand */}
      <div className="px-4 py-4 border-b border-white/5 flex items-center gap-2.5">
        <img src={logo} alt="Spencer Group" className="h-7 w-7 object-contain bg-white rounded p-0.5" />
        <div className="leading-tight">
          <div className="text-white font-semibold text-[13px]">Report Portal</div>
          <div className="text-[10.5px] text-white/50">Spencer Group</div>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
        <NavSection label="Operations" />
        {primaryNav.map(item => <NavItem key={item.to} {...item} />)}

        <NavSection label="Admin" className="mt-5" />
        {adminNav.map(item => <NavItem key={item.to} {...item} />)}
      </nav>

      {/* User pill */}
      <div className="px-3 py-3 border-t border-white/5 flex items-center gap-2.5">
        <div className="h-7 w-7 rounded-full bg-[var(--color-brand-500)] text-white text-[11px] font-semibold flex items-center justify-center">
          AD
        </div>
        <div className="flex-1 min-w-0 leading-tight">
          <div className="text-white text-[12px] font-medium truncate">Admin</div>
          <div className="text-[10.5px] text-white/50 truncate">self-hosted v0.4.2</div>
        </div>
      </div>
    </aside>
  );
}

function NavSection({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div className={`px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40 ${className}`}>
      {label}
    </div>
  );
}

function NavItem({
  to, label, icon: Icon, disabled, matchTab,
}: {
  to: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  disabled?: boolean;
  matchTab?: string;
}) {
  const location = useLocation();
  if (disabled) {
    return (
      <div
        title="Coming soon"
        className="flex items-center gap-2.5 px-3 py-2 rounded text-white/30 cursor-not-allowed select-none"
      >
        <Icon className="h-4 w-4" />
        <span>{label}</span>
        <span className="ml-auto text-[9.5px] uppercase tracking-wider text-white/30">Soon</span>
      </div>
    );
  }

  // Custom active logic for tabbed routes (Admin / Templates share /admin).
  // Falls back to NavLink's default isActive when no matchTab is set.
  const isActive = (() => {
    if (!matchTab) return undefined;
    const path = to.split("?")[0];
    if (location.pathname !== path) return false;
    const currentTab = new URLSearchParams(location.search).get("tab");
    if (matchTab === "projects") return !currentTab || currentTab === "projects";
    return currentTab === matchTab;
  })();

  return (
    <NavLink
      to={to}
      end={!matchTab ? false : undefined}
      className={({ isActive: defaultActive }) => {
        const active = matchTab ? !!isActive : defaultActive;
        return [
          "flex items-center gap-2.5 px-3 py-2 rounded transition-colors",
          active
            ? "bg-[var(--color-sidebar-active)] text-white"
            : "text-white/70 hover:bg-[var(--color-sidebar-hover)] hover:text-white",
        ].join(" ");
      }}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </NavLink>
  );
}

/* ----------------- icons (no dependency) ----------------- */
function IconDashboard({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <rect x="3" y="3" width="6" height="8" rx="1.2" />
      <rect x="11" y="3" width="6" height="5" rx="1.2" />
      <rect x="11" y="10" width="6" height="7" rx="1.2" />
      <rect x="3" y="13" width="6" height="4" rx="1.2" />
    </svg>
  );
}
function IconMetrics({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M3 17V8M8 17V4M13 17v-7M18 17v-3" strokeLinecap="round" />
    </svg>
  );
}
function IconForms({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <rect x="4" y="3" width="12" height="14" rx="1.5" />
      <path d="M7 7h6M7 10h6M7 13h4" />
    </svg>
  );
}
function IconSites({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M10 17s5.5-5 5.5-9a5.5 5.5 0 0 0-11 0c0 4 5.5 9 5.5 9Z" />
      <circle cx="10" cy="8" r="2" />
    </svg>
  );
}
function IconAdmin({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M10 2.5 4 5v4.2c0 3.6 2.6 6.7 6 8 3.4-1.3 6-4.4 6-8V5l-6-2.5Z" />
      <path d="m7.5 10 1.7 1.7L13 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconTemplate({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <rect x="3" y="3" width="14" height="4" rx="1" />
      <rect x="3" y="9" width="6" height="8" rx="1" />
      <rect x="11" y="9" width="6" height="8" rx="1" />
    </svg>
  );
}
function IconCog({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.4 4.4l1.4 1.4M14.2 14.2l1.4 1.4M4.4 15.6l1.4-1.4M14.2 5.8l1.4-1.4" />
    </svg>
  );
}
function IconLog({ className = "" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M5 3h7l3 3v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M7 9h6M7 12h6M7 15h4" />
    </svg>
  );
}
