import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import NavBar from "./components/NavBar";
import SitesPage from "./pages/SitesPage";
import FormsPage from "./pages/FormsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="max-w-6xl mx-auto p-6">
          <header className="mb-4 pb-3 border-b-2 border-[#233E99]">
            <h1 className="text-2xl font-bold text-[#233E99]">Dalux Report Portal</h1>
            <p className="text-sm text-gray-600 mt-1">Local prototype · connected to live MariaDB</p>
          </header>

          <NavBar />

          <Routes>
            <Route path="/" element={<FormsPage />} />
            <Route path="/sites" element={<SitesPage />} />
          </Routes>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}