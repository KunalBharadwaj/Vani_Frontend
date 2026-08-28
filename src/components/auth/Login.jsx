const GoogleIcon = (props) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
    <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
    <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
  </svg>
);

export const Login = () => {
  const handleLogin = () => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || "https://vani-backend-mjsl.onrender.com";
    const redirectTo = window.location.pathname + window.location.search;
    const nonce = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem("oauth_nonce", nonce);

    // A-3: Pass both redirectTo and nonce via base64 encoded JSON state
    const stateObj = { redirectTo, nonce };
    const stateB64 = btoa(JSON.stringify(stateObj));

    window.location.href = `${backendUrl}/auth/google?state=${stateB64}`;
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden p-4">
      {/* Decorative floating orbs, layered above the global ambient background */}
      <div className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 rounded-full bg-primary/30 blur-3xl animate-float-slow" />
      <div
        className="pointer-events-none absolute -bottom-32 -right-16 w-96 h-96 rounded-full bg-[hsl(var(--glow-violet)/0.30)] blur-3xl animate-float-slow"
        style={{ animationDelay: "1.5s" }}
      />

      <div className="glass-card animate-glass-in relative w-full max-w-sm rounded-3xl p-8 text-center space-y-7">
        <div className="space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[hsl(var(--glow-violet))] shadow-lg shadow-primary/30">
            <span className="text-2xl font-bold text-white">C</span>
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Chanakya Paint
          </h1>
          <p className="text-sm text-muted-foreground">Collaborative educational drawing board.</p>
        </div>

        <button
          onClick={handleLogin}
          className="group flex w-full h-12 items-center justify-center gap-3 rounded-xl bg-white/90 text-slate-800 font-medium text-sm shadow-md shadow-black/10 transition-all duration-200 hover:bg-white hover:shadow-lg hover:shadow-black/15 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <p className="text-xs text-muted-foreground/70">
          To collaborate with others or save your work to the cloud, please sign in.
        </p>
      </div>
    </div>
  );
};
