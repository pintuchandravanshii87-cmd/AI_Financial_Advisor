import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons.jsx";
import { palette } from "./charts.jsx";
import { api, clip, fmtDate, fmtTime, level, LEVEL_TEXT, money, monthSeries } from "./lib.js";

/* count-up used once when the stat cards appear */
export function useCountUp(target, ms = 800) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setV(target); return; }
    let raf, t0;
    const step = (t) => {
      t0 ??= t;
      const k = Math.min((t - t0) / ms, 1);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/* tiny safe renderer: **bold** and "- " bullets, no HTML injection */
export function Rich({ text }) {
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.length > 4 && p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p);
  return text.split("\n").map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} className="gap" />;
    if (/^[-*•]\s+/.test(t)) return <div key={i} className="li">• {inline(t.replace(/^[-*•]\s+/, ""))}</div>;
    return <p key={i}>{inline(t)}</p>;
  });
}

export function Field({ label, error, hint, children }) {
  return (
    <label className={"f" + (error ? " bad" : "")}>
      <span>{label}</span>
      {children}
      {error ? <em className="ferr" role="alert">{error}</em> : hint ? <em className="hint">{hint}</em> : null}
    </label>
  );
}

export function Sidebar({ view, setView, onReset }) {
  const items = [
    ["dashboard", "home", "Dashboard"],
    ["chat", "chat", "Ask the advisor"],
    ["history", "chart", "Past conversations"],
  ];
  return (
    <nav className="side" aria-label="Main">
      <div className="brand" title="AI Financial Advisor">
        <Icon name="trend" size={22} /><b>Advisor</b>
      </div>
      <div className="nav">
        {items.map(([id, icon, label]) => (
          <button key={id} className={"nb" + (view === id ? " on" : "")} onClick={() => setView(id)}
            title={label} aria-label={label} aria-current={view === id ? "page" : undefined}>
            <Icon name={icon} />
          </button>
        ))}
      </div>
      <div className="nav bottom">
        <button className="nb" onClick={onReset} title="New profile" aria-label="New profile"><Icon name="power" /></button>
      </div>
    </nav>
  );
}

export function Topbar({ title, sub, search, setSearch, showSearch, alerts, theme, toggleTheme, health }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const warn = alerts.some((a) => a.tone === "warn");
  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return (
    <header className="top">
      <div className="ttl">
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <div className="tools">
        {health && (
          <span className={"dbchip " + health.db} title={health.db === "mysql"
            ? `Connected to MySQL database "${health.database}"`
            : "MySQL is not reachable, so the backend fell back to SQLite. Check DATABASE_URL in backend/.env and that XAMPP MySQL is running."}>
            <Icon name="db" size={14} />{health.db === "mysql" ? health.database : "SQLite fallback"}
          </span>
        )}
        {showSearch && (
          <label className="search">
            <Icon name="search" size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
          </label>
        )}
        <span className="datechip" title="Today"><Icon name="calendar" size={18} /><span>{today}</span></span>
        <button className="ib" onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">
          <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
        </button>
        <div className="pop" ref={box}>
          <button className="ib" onClick={() => setOpen((o) => !o)} aria-label="Insights" aria-expanded={open}>
            <Icon name="bell" size={18} />{warn && <i className="dot" />}
          </button>
          {open && (
            <div className="popmenu" role="dialog" aria-label="Insights">
              <h4>Insights from your numbers</h4>
              {alerts.map((a, i) => (
                <p key={i} className={"ins " + a.tone}><Icon name={a.tone === "good" ? "check" : "alert"} size={15} />{a.text}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export function StatCard({ icon, label, value, suffix = "", money: isMoney = true, decimals = 0 }) {
  const v = useCountUp(value ?? 0);
  const shown = value == null ? "—" : isMoney ? money(v) : v.toFixed(decimals) + suffix;
  return (
    <div className="stat">
      <b>{shown}</b>
      <span className="sico"><Icon name={icon} size={26} /></span>
      <small>{label}</small>
    </div>
  );
}

export function CreditCardView({ profile, uid }) {
  const last4 = String(uid ?? 0).padStart(4, "0").slice(-4);
  return (
    <div className="ccard">
      <div className="cc-top">
        <span className="cc-num">•••• •••• •••• {last4}</span>
        <span className="chip-ic" aria-hidden="true" />
      </div>
      <div className="cc-mid">
        <small>AVAILABLE SAVINGS</small>
        <b>{money(profile.savings)}</b>
      </div>
      <div className="cc-bot">
        <strong>{(profile.risk || "moderate").toUpperCase()} RISK</strong>
        <span><small>AGE</small>{profile.age || "—"}</span>
        <span className="cc-goal"><small>GOAL</small>{clip(profile.goal, 22) || "—"}</span>
      </div>
    </div>
  );
}

export function RightPanel({ profile, uid, m }) {
  const rows = [
    { icon: "percent", title: "Savings rate", sub: m.savingsRate == null ? "Add expenses" : "of income kept", val: m.savingsRate == null ? "—" : m.savingsRate.toFixed(1) + "%", lv: level("rate", m.savingsRate) },
    { icon: "shield", title: "Emergency fund", sub: "months of expenses", val: m.runway == null ? "—" : m.runway.toFixed(1), lv: level("runway", m.runway) },
    { icon: "card", title: "Debt load", sub: "of yearly income", val: m.dti == null ? "—" : m.dti.toFixed(0) + "%", lv: level("dti", m.dti) },
  ];
  const recent = monthSeries(profile.expenses || [], 12).slice(-3).reverse();
  const all = monthSeries(profile.expenses || [], 12);
  return (
    <aside className="panel">
      <div className="me">
        <span className="av big">{(profile.name || "?").slice(0, 1).toUpperCase()}</span>
        <b>{profile.name}</b>
      </div>
      <CreditCardView profile={profile} uid={uid} />
      <section>
        <h3>Health checks</h3>
        <small className="sub">Based on your profile</small>
        <ul className="plist">
          {rows.map((r) => (
            <li key={r.title}>
              <span className="pi"><Icon name={r.icon} size={18} /></span>
              <div><b>{r.title}</b><small className={"lv " + r.lv}>{LEVEL_TEXT[r.lv]} · {r.sub}</small></div>
              <strong>{r.val}</strong>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Latest expenses</h3>
        <small className="sub">Most recent months</small>
        {recent.length === 0 && <p className="muted">No expenses entered yet.</p>}
        <ul className="plist">
          {recent.map((r, i) => {
            const prev = all[all.length - 2 - i]?.value;
            const delta = r.value != null && prev != null ? r.value - prev : null;
            return (
              <li key={i}>
                <span className="pi alt"><Icon name={delta != null && delta > 0 ? "trend" : "wallet"} size={18} /></span>
                <div><b>{r.label} {String(r.year).slice(2)}</b>
                  <small>{delta == null ? (r.value == null ? "Missing month" : all.length - 1 - i === 0 ? "First entry" : "Previous month missing") : `${delta > 0 ? "+" : "−"}${money(Math.abs(delta))} vs previous`}</small></div>
                <strong>{r.value == null ? "—" : money(r.value)}</strong>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}

export function ConvTable({ rows, onOpen, full = false, empty }) {
  if (!rows.length) return <p className="muted pad">{empty}</p>;
  return (
    <div className="tablewrap">
      <table className="ctable">
        <thead><tr>
          <th>Person</th><th>First question</th>{full && <th>Topics</th>}<th>Last active</th><th className="num">Messages</th><th />
        </tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.user_id} onClick={() => onOpen(c)} tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(c))}>
              <td><span className="who"><span className="av" style={{ background: palette(c.user_id) }}>{(c.name || "?").slice(0, 1).toUpperCase()}</span>{c.name}</span></td>
              <td className="q">{clip(c.first_question, full ? 70 : 38) || "—"}</td>
              {full && <td><span className="pills">{c.topics.length ? c.topics.map((t) => <i key={t}>{t}</i>) : <i>—</i>}</span></td>}
              <td>{fmtDate(c.last_at)}</td>
              <td className="num"><span className="cnt">{c.messages}</span></td>
              <td className="go">Open</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* slide-in transcript for one stored conversation */
export function Drawer({ conv, onClose, onChat, isMine }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setRows(null); setErr("");
    api(`/history/${conv.user_id}`).then((r) => live && setRows(r)).catch((e) => live && setErr(e.message));
    const esc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => { live = false; document.removeEventListener("keydown", esc); };
  }, [conv.user_id, onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-label={`Conversation with ${conv.name}`}>
        <div className="dr-head">
          <span className="av big" style={{ background: palette(conv.user_id) }}>{(conv.name || "?").slice(0, 1).toUpperCase()}</span>
          <div><b>{conv.name}</b><small>{conv.messages} messages · since {fmtDate(conv.first_at)}</small></div>
          <button className="ib" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </div>
        <div className="dr-body">
          {err && <p className="err">{err}</p>}
          {!rows && !err && <p className="muted">Loading conversation…</p>}
          {rows?.length === 0 && <p className="muted">No messages stored.</p>}
          {rows?.map((m, i) => (
            <div key={m.id ?? i} className={`m ${m.role === "user" ? "user" : "advisor"}`}>
              <Rich text={String(m.content ?? "")} />
              {m.created && <small className="stamp">{fmtDate(m.created)} · {fmtTime(m.created)}</small>}
            </div>
          ))}
        </div>
        {isMine && <div className="dr-foot"><button onClick={onChat}>Continue in chat<Icon name="arrow" size={16} /></button></div>}
      </aside>
    </div>
  );
}
