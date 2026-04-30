import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import logo from "../assets/spencer-logo.png";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where to send the user after successful login. If they were redirected
  // here from somewhere protected, go back; otherwise straight to dashboard.
  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  // If already signed in, bounce.
  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } } | null)?.response?.data?.detail ??
        "Could not sign in. Please try again.";
      setError(typeof detail === "string" ? detail : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{ background: "var(--color-surface)" }}
    >
      <div
        className="w-full max-w-md p-8 rounded border"
        style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-3 mb-6">
          <img src={logo} alt="Spencer Group" className="h-9 w-9 object-contain bg-white rounded p-0.5 border" style={{ borderColor: "var(--color-border)" }} />
          <div>
            <div className="text-[15px] font-semibold leading-tight">Report Portal</div>
            <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>Spencer Group</div>
          </div>
        </div>

        <h1 className="text-[20px] font-semibold mb-1">Sign in</h1>
        <p className="text-[12.5px] mb-5" style={{ color: "var(--color-text-muted)" }}>
          Enter the email and password your administrator gave you.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Email">
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-[13px] rounded border outline-none focus:border-[var(--color-brand-500)]"
              style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border-strong)", color: "var(--color-text)" }}
              placeholder="you@thespencergroup.co.uk"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-[13px] rounded border outline-none focus:border-[var(--color-brand-500)]"
              style={{ background: "var(--color-surface-raised)", borderColor: "var(--color-border-strong)", color: "var(--color-text)" }}
            />
          </Field>

          {error && (
            <div
              className="px-3 py-2 rounded text-[12.5px] border"
              style={{ background: "var(--color-danger-50)", color: "var(--color-danger-700)", borderColor: "var(--color-danger-200)" }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full px-3 py-2.5 rounded text-[13.5px] font-semibold transition-colors disabled:opacity-60"
            style={{ background: "var(--color-brand-600)", color: "#fff" }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-[11.5px] mt-6 leading-relaxed" style={{ color: "var(--color-text-faint)" }}>
          Forgot your password? An administrator can reset it from the Users tab.
          This portal is reachable only on the Spencer VPN.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10.5px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--color-text-faint)" }}>{label}</div>
      {children}
    </label>
  );
}
