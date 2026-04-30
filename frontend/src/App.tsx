import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import DashboardPage from "./pages/DashboardPage";
import MetricsPage from "./pages/MetricsPage";
import SectorsPage from "./pages/SectorsPage";
import ProjectDashboardPage from "./pages/ProjectDashboardPage";
import SitesPage from "./pages/SitesPage";
import FormsPage from "./pages/FormsPage";
import AdminPage from "./pages/AdminPage";
import LoginPage from "./pages/LoginPage";
import { AuthProvider, useAuth } from "./auth/AuthContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  // DARK_MODE_HOOK — read persisted preference on mount.
  useEffect(() => {
    const saved = localStorage.getItem("dalux:mode");
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-mode", saved);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/* RequireAuth — gate every non-/login route. While loading the cached session
   render a minimal placeholder; once resolved either show the protected
   content or bounce to /login carrying the original path so we can return
   the user there after sign-in. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="h-screen w-screen grid place-items-center" style={{ background: "var(--color-surface)", color: "var(--color-text-muted)" }}>
        <div className="text-[13px]">Loading…</div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

function AppShell() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-surface)] text-[var(--color-text)]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/metrics" element={<MetricsPage />} />
            <Route path="/dashboard/sectors" element={<SectorsPage />} />
            <Route path="/forms" element={<FormsPage />} />
            <Route path="/sites" element={<SitesPage />} />
            <Route path="/sites/:sosNumber" element={<ProjectDashboardPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
