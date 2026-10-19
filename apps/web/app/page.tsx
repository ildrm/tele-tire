import {
  ArrowRight,
  Check,
  Send,
  ShieldCheck,
  Star,
  Users,
  Zap,
} from "lucide-react";
export default function Home() {
  return (
    <main className="landing">
      <nav className="landing-nav">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Send size={21} />
          </span>
          TeleTier
        </a>
        <a className="button secondary" href="/login">
          Creator login <ArrowRight size={16} />
        </a>
      </nav>
      <section className="hero">
        <span className="eyebrow">
          <span className="dot" /> BUILT FOR TELEGRAM CREATORS
        </span>
        <h1>
          Your community.
          <br />A little more <em>connected.</em>
        </h1>
        <p>
          Turn your expertise into a paid Telegram community.
          <br />
          Stars subscriptions, member access, and renewals — all in one place.
        </p>
        <div className="hero-actions">
          <a href="/login" className="button">
            Open your workspace <ArrowRight size={18} />
          </a>
          <span>Bring your own bot. Keep your community.</span>
        </div>
        <div className="hero-proof">
          <span>
            <Check size={16} /> Telegram Stars payments
          </span>
          <span>
            <Check size={16} /> Your bot, your Stars
          </span>
          <span>
            <Check size={16} /> Clear membership terms
          </span>
        </div>
      </section>
      <section className="landing-features">
        {[
          [
            Users,
            "Make room for your members",
            "Connect private channels and learning groups. Give each plan the access it needs.",
          ],
          [
            Star,
            "Memberships that make sense",
            "30-day auto-renewing subscriptions, or 90- and 365-day prepaid access. Always in Stars.",
          ],
          [
            ShieldCheck,
            "Keep access under control",
            "Verify paid members before they join. Reconcile access when paid time expires.",
          ],
        ].map(([Icon, title, body]) => {
          const I = Icon as typeof Users;
          return (
            <article className="panel" key={String(title)}>
              <span className="feature-icon">
                <I size={23} />
              </span>
              <h2>{String(title)}</h2>
              <p>{String(body)}</p>
            </article>
          );
        })}
      </section>
      <footer className="landing-footer">
        © {new Date().getUTCFullYear()} TeleTier{" "}
        <span>Built for thoughtful communities.</span>
        <a href="/login">
          Get started <ArrowRight size={14} />
        </a>
      </footer>
    </main>
  );
}
