import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import DashboardPage from "./pages/DashboardPage";
import SectorsPage from "./pages/SectorsPage";
import ProjectDashboardPage from "./pages/ProjectDashboardPage";
import SitesPage from "./pages/SitesPage";
import FormsPage from "./pages/FormsPage";
import AdminPage from "./pages/AdminPage";

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
        <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-surface)] text-[var(--color-text)]">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <TopBar />
            <main className="flex-1 overflow-auto">
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/dashboard/sectors" element={<SectorsPage />} />
                <Route path="/forms" element={<FormsPage />} />
                <Route path="/sites" element={<SitesPage />} />
                <Route path="/sites/:sosNumber" element={<ProjectDashboardPage />} />
                <Route path="/admin" element={<AdminPage />} />
              </Routes>
            </main>
          </div>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
