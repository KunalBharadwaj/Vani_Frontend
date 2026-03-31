// Root application shell.
// Sets up global providers (tooltips, toasts, React Query) and client-side routing.
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useSearchParams } from "react-router-dom";
import { Suspense, lazy, useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { Login } from "./components/auth/Login";

// Lazy load PDF page to avoid blocking initial load
const PDFPage = lazy(() => import("./pages/PDFPage"));

// Single shared React Query client for the whole app.
const queryClient = new QueryClient();

// Keep both Paint and PDF pages mounted across route changes so their state
// (canvas drawings, open files, annotations) is preserved when navigating.
const PersistentPages = () => {
  const location = useLocation();
  const isPDFRoute = location.pathname === "/pdf";
  const isPaintRoute = location.pathname === "/";

  return (
    <>
      {/* Paint page - always mounted, visible on / route */}
      <div className={isPaintRoute ? "block" : "hidden"}>
        <Index />
      </div>
      {/* PDF page - always mounted, visible on /pdf route */}
      <div className={isPDFRoute ? "block" : "hidden"}>
        <PDFPage />
      </div>
    </>
  );
};

const AuthWrapper = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [token, setToken] = useState(localStorage.getItem("auth_token"));

  useEffect(() => {
    const urlToken = searchParams.get("token");
    if (urlToken) {
      localStorage.setItem("auth_token", urlToken);
      setToken(urlToken);
      searchParams.delete("token");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (!token) {
    return <Login />;
  }

  return children;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    {/* TooltipProvider enables Radix / shadcn tooltips across the app */}
    <TooltipProvider>
      {/* shadcn/ui toast system */}
      <Toaster />
      {/* Sonner toast system for transient notifications */}
      <Sonner />

      {/* BrowserRouter handles client-side navigation between pages */}
      <BrowserRouter>
        <AuthWrapper>
          <Navigation />
          <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
            <Routes>
              {/* Placeholder routes - actual pages are always mounted below */}
              <Route path="/" element={<div />} />
              <Route path="/pdf" element={<div />} />
              {/* Catch-all fallback for unknown routes */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            {/* Always-mounted pages, shown/hidden based on route */}
            <PersistentPages />
          </Suspense>
        </AuthWrapper>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;