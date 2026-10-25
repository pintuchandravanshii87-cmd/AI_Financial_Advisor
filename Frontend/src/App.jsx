import { useCallback, useEffect, useRef, useState } from "react";
import "./styles.css";
import { Drawer, RightPanel, Sidebar, Topbar } from "./parts.jsx";
import { ChatView, Dashboard, HistoryView, Onboarding } from "./views.jsx";
import { api, clearSession, greet, insights, loadSession, metrics, saveSession } from "./lib.js";

const toProfile = (p) => ({
  name: p.name, age: p.age, income: p.income, savings: p.savings, debt: p.debt,
  risk: p.risk, goal: p.goal, expenses: p.monthly_expenses ?? p.expenses ?? [],
});

export default function App() {
  const saved = loadSession();
  const [uid, setUid] = useState(saved?.uid ?? null);
  const [profile, setProfile] = useState(saved?.profile ?? null);
  const [view, setView] = useState("dashboard");
  const [theme, setTheme] = useState(() => localStorage.getItem("fa_theme") || "light");
  const [health, setHealth] = useState(null);
  const [scope, setScope] = useState("all");
  const [an, setAn] = useState({ data: null, loading: false, error: "" });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null);

  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const ctrl = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("fa_theme", theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => { api("/health").then(setHealth).catch(() => setHealth(null)); }, [uid]);

  // refresh the profile from the database (also repairs sessions saved by the old UI)
  useEffect(() => {
    if (!uid) return;
    api(`/profile/${uid}`).then((p) => {
      const full = toProfile(p);
      setProfile(full);
      saveSession({ uid, profile: full });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // restore stored chat after a refresh
  useEffect(() => {
    if (!uid) return;
    api(`/history/${uid}`)
      .then((rows) => setMsgs(rows.map((m) => ({ role: m.role, text: String(m.content ?? ""), at: m.created }))))
      .catch(() => {});
  }, [uid]);

  const loadAnalytics = useCallback(async () => {
    setAn((s) => ({ ...s, loading: true, error: "" }));
    try {
      const d = await api(`/analytics/conversations${scope === "me" && uid ? `?user_id=${uid}` : ""}`);
      setAn({ data: d, loading: false, error: "" });
    } catch (e) {
      setAn({ data: null, loading: false, error: e.message });
    }
  }, [scope, uid]);
  useEffect(() => { if (uid) loadAnalytics(); }, [uid, loadAnalytics]);

  useEffect(() => {
    if (!busy) return;
    setSecs(0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  function done(id, p) {
    saveSession({ uid: id, profile: p });
    setProfile(p); setUid(id); setMsgs([]); setView("chat"); setErr("");
  }

  function reset() {
    clearSession();
    setUid(null); setProfile(null); setMsgs([]); setErr(""); setAn({ data: null, loading: false, error: "" });
    setSearch(""); setOpen(null);
  }

  async function send(text) {
    const question = String(text ?? "").trim();
    if (!question || busy) return;
    setErr(""); setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: question, at: new Date().toISOString() }]);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const d = await api("/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, question }), signal: c.signal,
      });
      setMsgs((m) => [...m, { role: "advisor", text: String(d.answer ?? ""), sources: Array.isArray(d.sources) ? d.sources : [], at: new Date().toISOString() }]);
      loadAnalytics();
    } catch (e) {
      setErr(e.name === "AbortError" ? "Stopped." : e.message);
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    const last = [...msgs].reverse().find((m) => m.role === "user");
    if (!last) return;
    setMsgs((m) => m.slice(0, -1)); // drop the unanswered question and resend it
    send(last.text);
  }

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  if (!uid || !profile) {
    return <Onboarding onDone={done} theme={theme} toggleTheme={toggleTheme} />;
  }

  const m = metrics(profile);
  const first = (profile.name || "").split(" ")[0];
  const titles = {
    dashboard: ["Dashboard", `Hi ${first}, ${greet()}!`],
    chat: ["Ask the advisor", "Answers use your profile and the knowledge base"],
    history: ["Past conversations", "Everything stored in the messages table"],
  };
  const [title, sub] = titles[view];
  const withPanel = view !== "history";

  return (
    <div className={"shell" + (withPanel ? "" : " nopanel")}>
      <Sidebar view={view} setView={setView} onReset={reset} />
      <main className="main">
        <Topbar title={title} sub={sub} search={search} setSearch={setSearch} showSearch={view !== "chat"}
          alerts={insights(profile, m)} theme={theme} toggleTheme={toggleTheme} health={health} />
        {view === "dashboard" && <Dashboard profile={profile} m={m} an={an} search={search} onOpen={setOpen} goHistory={() => setView("history")} />}
        {view === "chat" && <ChatView profile={profile} msgs={msgs} busy={busy} secs={secs} err={err}
          onSend={send} onStop={() => ctrl.current?.abort()} onRetry={retry} />}
        {view === "history" && <HistoryView an={an} scope={scope} setScope={setScope} search={search} onOpen={setOpen} uid={uid} />}
      </main>
      {withPanel && <RightPanel profile={profile} uid={uid} m={m} />}
      {open && <Drawer conv={open} onClose={() => setOpen(null)} isMine={open.user_id === uid}
        onChat={() => { setOpen(null); setView("chat"); }} />}
    </div>
  );
}
