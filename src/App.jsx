// Root application shell.
// Sets up global providers (tooltips, toasts, React Query) and client-side routing.
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useSearchParams } from "react-router-dom";
import { Suspense, lazy, useEffect, useState } from "react";
import React from "react";
import Navigation from "@/components/Navigation";
import Index from "./pages/Index";
import { ThemeProvider } from "@/context/ThemeContext";
import NotFound from "./pages/NotFound";
import { Login } from "./components/auth/Login";

export const AuthContext = React.createContext(null);

// Lazy load PDF page to avoid blocking initial load
const PDFPage = lazy(() => import("./pages/PDFPage"));

// Single shared React Query client for the whole app.
const queryClient = new QueryClient();

// Keep both Paint and PDF pages mounted across route changes so their state
// (canvas drawings, open files, annotations) is preserved when navigating.
// IMPORTANT: We use visibility:hidden + position:fixed instead of display:none
// because react-pdf canvases lose their rendered content when inside display:none
// containers. visibility:hidden keeps them rendered at full size off-screen.
const hiddenStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: '100vh',
  visibility: 'hidden',
  pointerEvents: 'none',
  zIndex: -1,
};

const PersistentPages = () => {
  const location = useLocation();
  const isPDFRoute = location.pathname === "/pdf";
  const isPaintRoute = location.pathname === "/";

  return (
    <>
      {/* Paint page - always mounted, visible on / route */}
      <div style={isPaintRoute ? undefined : hiddenStyle}>
        <Index />
      </div>
      {/* PDF page - always mounted, visible on /pdf route */}
      <div style={isPDFRoute ? undefined : hiddenStyle}>
        <PDFPage />
      </div>
    </>
  );
};

const AuthWrapper = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A-1: Check backend for valid cookie if no URL token exists
    const urlToken = searchParams.get("token");
    const urlNonce = searchParams.get("nonce");

    if (urlToken) {
      // A-3: CSRF Defense — verify nonce against sessionStorage
      const savedNonce = sessionStorage.getItem("oauth_nonce");
      if (savedNonce && urlNonce === savedNonce) {
        setToken(urlToken);
        sessionStorage.removeItem("oauth_nonce");
      } else {
        console.error("[Vani] Auth failed: CSRF nonce mismatch or missing");
      }
      searchParams.delete("token");
      searchParams.delete("nonce");
      setSearchParams(searchParams, { replace: true });
      setLoading(false);
      return;
    }

    // Try silent auth via httpOnly cookie
    const backendUrl = import.meta.env.VITE_BACKEND_URL || "https://vani-backend-mjsl.onrender.com";
    fetch(`${backendUrl}/api/auth/me`, { credentials: "omit" }) // We will use 'include' when properly set up, but backend runs on port 10000. Actually we must use 'include'.
      .catch(() => null) // Ignore fetch failures (handled implicitly)
      .finally(() => {
        // Correct fetch with credentials
        fetch(`${backendUrl}/api/auth/me`, { credentials: "include" })
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data?.token) setToken(data.token);
          })
          .catch(() => {})
          .finally(() => setLoading(false));
      });
  }, [searchParams, setSearchParams]);

  if (loading) return <div style={{ padding: 20 }}>Authenticating...</div>;
  if (!token) return <Login />;

  return <AuthContext.Provider value={token}>{children}</AuthContext.Provider>;
};

const App = () => (
  <ThemeProvider>
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
  </ThemeProvider>
);

export default App;