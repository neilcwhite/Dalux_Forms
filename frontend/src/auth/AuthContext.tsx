import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { login as apiLogin, fetchMe, type AuthUser } from "../api";

/* ============================================================
   Email + bcrypt-password auth — stop-gap before Azure Entra.
   Session lives in localStorage as a JSON blob with a 30-day expiry.
   No JWT, no signed cookie — backend is honor-system, security comes
   from VPN-only network access.
   ============================================================ */

const STORAGE_KEY = "dalux:auth";
const SESSION_DAYS = 30;

interface StoredSession {
  user: AuthUser;
  expires_at: number; // ms epoch
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;       // true during initial load + while validating cached session
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: read cached session, validate against /api/auth/me
  useEffect(() => {
    (async () => {
      const cached = readStored();
      if (!cached) {
        setLoading(false);
        return;
      }
      try {
        // Confirm the email is still active server-side. If the admin
        // deactivated this user, this returns 401 and we drop the session.
        const fresh = await fetchMe(cached.user.email);
        setUser(fresh);
      } catch {
        clearStored();
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function signIn(email: string, password: string) {
    const u = await apiLogin(email, password);
    writeStored({ user: u, expires_at: Date.now() + SESSION_DAYS * 86400_000 });
    setUser(u);
  }

  function signOut() {
    clearStored();
    setUser(null);
  }

  async function refresh() {
    if (!user) return;
    try {
      const fresh = await fetchMe(user.email);
      setUser(fresh);
      writeStored({ user: fresh, expires_at: Date.now() + SESSION_DAYS * 86400_000 });
    } catch {
      // Session no longer valid
      clearStored();
      setUser(null);
    }
  }

  return (
    <AuthCtx.Provider value={{ user, loading, signIn, signOut, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

// --- helpers ---------------------------------------------------------------

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.user?.email || !parsed.expires_at) return null;
    if (parsed.expires_at < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(s: StoredSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function clearStored() {
  localStorage.removeItem(STORAGE_KEY);
}
