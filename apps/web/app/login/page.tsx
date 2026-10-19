"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Send, ShieldCheck } from "lucide-react";
export default function Login() {
  const [dev, setDev] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((v) => setDev(v.developmentLogin))
      .catch(() =>
        setError("The API is unavailable. Start the API and retry."),
      );
  }, []);
  async function local() {
    setBusy(true);
    try {
      const r = await fetch("/api/auth/dev", { method: "POST" });
      if (!r.ok) throw new Error("Local sign-in failed");
      window.location.assign("/dashboard");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <a href="/" className="brand">
        <span className="brand-icon">
          <Send size={21} />
        </span>
        TeleTier
      </a>
      <section className="login-card panel">
        <span className="feature-icon">
          <ShieldCheck size={27} />
        </span>
        <h1>Welcome to your workspace</h1>
        <p>Sign in with your Telegram account to manage your paid community.</p>
        <a href="/api/auth/login" className="button">
          <Send size={18} /> Continue with Telegram <ArrowRight size={17} />
        </a>
        {dev && (
          <>
            <div className="divider">LOCAL DEVELOPMENT</div>
            <button
              className="button secondary"
              disabled={busy}
              onClick={local}
            >
              {busy ? "Signing in…" : "Open local test workspace"}
            </button>
            <p className="small">
              Development identity is enabled for this local instance. Provider
              activity may be simulated.
            </p>
          </>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <p className="login-note">
          Your creator bot token is connected separately after sign-in.
        </p>
      </section>
      <span className="muted small">Your community. Your bot. Your Stars.</span>
    </main>
  );
}
