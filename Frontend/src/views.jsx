import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons.jsx";
import { BarChart, Donut, Heatmap, HBars, LineChart } from "./charts.jsx";
import { ConvTable, CreditCardView, Field, Rich, StatCard } from "./parts.jsx";
import { api, fmtDate, fmtTime, metrics, money, monthSeries, parseExpenses } from "./lib.js";

const blank = { name: "", age: 30, income: "", savings: "", debt: "", risk: "moderate", goal: "", expenses: "" };

/* ───────────── first screen: the form (Enter submits from any field) ───────────── */
export function Onboarding({ onDone, theme, toggleTheme }) {
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [apiErr, setApiErr] = useState("");
  const [saving, setSaving] = useState(false);
  const on = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined })); };

  const exp = useMemo(() => parseExpenses(form.expenses), [form.expenses]);
  const preview = { ...form, expenses: exp.values };
  const m = metrics(preview);

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = "Enter your name";
    const age = Number(form.age);
    if (!Number.isFinite(age) || age < 10 || age > 120) e.age = "Enter an age between 10 and 120";
    if (!(Number(form.income) > 0)) e.income = "Enter your monthly income";
    if (form.savings !== "" && Number(form.savings) < 0) e.savings = "Can't be negative";
    if (form.debt !== "" && Number(form.debt) < 0) e.debt = "Can't be negative";
    return e;
  }

  async function submit(ev) {
    ev.preventDefault();
    if (saving) return;
    const formEl = ev.currentTarget;
    const e = validate();
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) { formEl.elements[first]?.focus(); return; }
    setApiErr(""); setSaving(true);
    const body = {
      name: form.name.trim(), age: +form.age, income: +form.income, savings: +form.savings || 0,
      debt: +form.debt || 0, risk: form.risk, goal: form.goal.trim(), monthly_expenses: exp.values,
    };
    try {
      const { user_id } = await api("/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      onDone(user_id, { name: body.name, age: body.age, income: body.income, savings: body.savings, debt: body.debt, risk: body.risk, goal: body.goal, expenses: exp.values });
    } catch (er) {
      setApiErr("Could not save your profile: " + er.message);
      setSaving(false);
    }
  }

  return (
    <div className="onb">
      <header className="onb-top">
        <div className="brand inline"><Icon name="trend" size={22} /><b>AI Financial Advisor</b></div>
        <button className="ib" onClick={toggleTheme} aria-label="Toggle dark mode"><Icon name={theme === "dark" ? "sun" : "moon"} size={18} /></button>
      </header>
      <div className="onb-grid">
        <form className="card form" onSubmit={submit} noValidate>
          <h2>Your finances</h2>
          <p className="muted">Fill this in once. Your dashboard and the advisor use it. Press Enter in any field to continue.</p>
          <div className="grid2">
            <Field label="Name" error={errors.name}><input name="name" autoFocus autoComplete="name" value={form.name} onChange={on("name")} placeholder="James Smith" /></Field>
            <Field label="Age" error={errors.age}><input name="age" type="number" inputMode="numeric" value={form.age} onChange={on("age")} /></Field>
            <Field label="Monthly income" error={errors.income}><input name="income" type="number" inputMode="decimal" step="any" min="0" value={form.income} onChange={on("income")} placeholder="5000" /></Field>
            <Field label="Savings" error={errors.savings}><input name="savings" type="number" inputMode="decimal" step="any" min="0" value={form.savings} onChange={on("savings")} placeholder="12000" /></Field>
            <Field label="Total debt" error={errors.debt}><input name="debt" type="number" inputMode="decimal" step="any" min="0" value={form.debt} onChange={on("debt")} placeholder="0" /></Field>
            <Field label="Risk tolerance">
              <select name="risk" value={form.risk} onChange={on("risk")}><option>low</option><option>moderate</option><option>high</option></select>
            </Field>
          </div>
          <Field label="Goal"><input name="goal" value={form.goal} onChange={on("goal")} placeholder="buy a home in 5 years" /></Field>
          <Field label="Monthly expenses, oldest to newest (x = missing month)"
            hint={exp.values.length ? `${exp.values.length} months read${exp.missing ? `, ${exp.missing} missing` : ""}` : "Separate months with commas"}>
            <input name="expenses" value={form.expenses} onChange={on("expenses")} placeholder="2400, 2550, x, 2700" />
          </Field>
          {apiErr && <p className="err" role="alert">{apiErr}</p>}
          <button type="submit" className="primary" disabled={saving}>{saving ? "Saving…" : "Start chatting"}<Icon name="arrow" size={16} /></button>
        </form>

        <div className="preview" aria-label="Live preview">
          <CreditCardView profile={{ ...preview, name: form.name }} uid={0} />
          <div className="card">
            <h3>Monthly expenses</h3>
            <small className="sub">Updates as you type</small>
            {exp.values.some((v) => v != null)
              ? <BarChart data={monthSeries(exp.values)} height={150} small />
              : <p className="muted pad">Add monthly expenses to see your spending chart.</p>}
          </div>
          <div className="mini3">
            <div><b>{m.savingsRate == null ? "—" : m.savingsRate.toFixed(1) + "%"}</b><small>Savings rate</small></div>
            <div><b>{m.runway == null ? "—" : m.runway.toFixed(1)}</b><small>Months covered</small></div>
            <div><b>{m.dti == null ? "—" : m.dti.toFixed(0) + "%"}</b><small>Debt vs income</small></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── dashboard ───────────── */
export function Dashboard({ profile, m, an, search, onOpen, goHistory }) {
  const rows = useMemo(() => filterConvs(an.data?.conversations || [], search), [an.data, search]);
  const series = monthSeries(profile.expenses || [], 12);
  const hasExp = series.some((s) => s.value != null);
  return (
    <>
      <div className="stats4">
        <StatCard icon="wallet" label="Monthly income" value={Number(profile.income) || 0} />
        <StatCard icon="dollar" label="Savings" value={Number(profile.savings) || 0} />
        <StatCard icon="card" label="Total debt" value={Number(profile.debt) || 0} />
        <StatCard icon="trend" label="Avg monthly expenses" value={m.avg} />
      </div>

      <section className="block">
        <div className="bh"><div><h3>Conversation history</h3><small className="sub">Stored in your database</small></div>
          <button className="link" onClick={goHistory}>See all<Icon name="arrow" size={14} /></button></div>
        {an.loading && !an.data && <p className="muted pad">Loading conversations…</p>}
        {an.error && <p className="err pad">Couldn't load conversations: {an.error}</p>}
        {an.data && <ConvTable rows={rows.slice(0, 4)} onOpen={onOpen}
          empty={search ? "No conversations match your search." : "No conversations yet. Ask the advisor a question to start one."} />}
      </section>

      <section className="block">
        <div className="bh"><div><h3>Monthly expenses</h3><small className="sub">Last {series.length || 12} months · dashed line is your average</small></div></div>
        {hasExp ? <BarChart data={series} /> : <p className="muted pad">No expenses entered. Start a new profile to add them.</p>}
      </section>
    </>
  );
}

export function filterConvs(list, q) {
  const s = q.trim().toLowerCase();
  if (!s) return list;
  return list.filter((c) => [c.name, c.first_question, c.last_question, ...(c.topics || [])].some((x) => (x || "").toLowerCase().includes(s)));
}

/* ───────────── chat (the bar is a <form>, so Enter always sends) ───────────── */
const CHIPS = ["How big should my emergency fund be?", "Should I pay off debt or invest?", "Is my savings rate healthy?", "Where can I cut spending?"];

export function ChatView({ profile, msgs, busy, secs, err, onSend, onStop, onRetry }) {
  const [q, setQ] = useState("");
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  const submit = (e) => { e.preventDefault(); if (!q.trim() || busy) return; onSend(q); setQ(""); };
  return (
    <section className="chat card">
      <div className="log" aria-live="polite">
        {msgs.length === 0 && (
          <div className="empty">
            <p>Hi{profile?.name ? `, ${profile.name.split(" ")[0]}` : ""}. Ask anything about your money.</p>
            <div className="chips">{CHIPS.map((c) => <button key={c} type="button" className="chip" onClick={() => onSend(c)} disabled={busy}>{c}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`m ${m.role}`}>
            <Rich text={m.text} />
            {m.sources?.length > 0 && <small>Sources: {m.sources.map((s) => `${s.id} ${s.source}`).join(", ")}</small>}
            {m.at && <small className="stamp">{fmtTime(m.at)}</small>}
          </div>
        ))}
        {busy && (
          <div className="m advisor wait">
            <span className="dots"><i /><i /><i /></span> Thinking… {secs}s
            <button type="button" className="ghost sm" onClick={onStop}>Stop</button>
          </div>
        )}
        <div ref={end} />
      </div>
      {err && <div className="err box"><span>{err}</span>{err !== "Stopped." && <button type="button" className="ghost sm" onClick={onRetry}>Retry</button>}</div>}
      <form className="bar" onSubmit={submit}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question" aria-label="Question" autoComplete="off" />
        <button type="submit" className="primary" disabled={busy || !q.trim()}><Icon name="send" size={16} />Send</button>
      </form>
    </section>
  );
}

/* ───────────── past conversations (analytics from the messages table) ───────────── */
export function HistoryView({ an, scope, setScope, search, onOpen, uid }) {
  const d = an.data;
  const rows = useMemo(() => filterConvs(d?.conversations || [], search), [d, search]);
  if (an.loading && !d) return <p className="muted pad">Loading from the database…</p>;
  if (an.error) return <div className="card"><p className="err">Couldn't load past conversations: {an.error}</p><p className="muted">Check the backend is running on port 8000 and XAMPP MySQL is started.</p></div>;
  if (!d) return null;
  const k = d.kpis;
  return (
    <>
      <div className="seg" role="group" aria-label="Whose conversations">
        <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>Everyone</button>
        <button className={scope === "me" ? "on" : ""} onClick={() => setScope("me")} disabled={!uid}>Only me</button>
      </div>

      {k.messages === 0 ? (
        <div className="card empty big"><h3>No past conversations yet</h3><p className="muted">Ask the advisor something and the chat will appear here with charts.</p></div>
      ) : (
        <>
          <div className="stats4">
            <StatCard icon="chat" label="Messages stored" value={k.messages} money={false} suffix="" />
            <StatCard icon="user" label="Conversations" value={k.conversations} money={false} />
            <StatCard icon="history" label="Avg answer length (chars)" value={k.avg_answer_chars} money={false} />
            <StatCard icon="shield" label="Answers with sources" value={k.cited_pct} money={false} suffix="%" />
          </div>

          <div className="two">
            <section className="block grow">
              <div className="bh"><div><h3>Activity</h3><small className="sub">{k.active_days} active day{k.active_days === 1 ? "" : "s"}</small></div>
                <span className="legend"><i className="sw u" />Questions<i className="sw a" />Answers</span></div>
              <LineChart points={d.per_day} />
            </section>
            <section className="block">
              <div className="bh"><div><h3>Questions vs answers</h3></div></div>
              <div className="donutbox">
                <Donut parts={[{ label: "Questions", value: k.questions, color: "var(--primary)" }, { label: "Answers", value: k.answers, color: "#4cc9f0" }]}
                  center={<><b>{k.messages}</b><small>messages</small></>} />
                <ul className="dl"><li><i className="sw u" />Questions <b>{k.questions}</b></li><li><i className="sw a" />Answers <b>{k.answers}</b></li></ul>
              </div>
            </section>
          </div>

          <div className="two">
            <section className="block grow">
              <div className="bh"><div><h3>What people ask about</h3><small className="sub">Topics found in questions</small></div></div>
              {d.topics.length ? <HBars items={d.topics} /> : <p className="muted pad">No topics yet.</p>}
            </section>
            <section className="block">
              <div className="bh"><div><h3>When questions are asked</h3><small className="sub">Weekday by hour</small></div></div>
              <Heatmap grid={d.heatmap} />
            </section>
          </div>

          <section className="block">
            <div className="bh"><div><h3>All conversations</h3><small className="sub">{rows.length} shown · select a row to read it</small></div></div>
            <ConvTable full rows={rows} onOpen={onOpen} empty="No conversations match your search." />
          </section>
        </>
      )}
    </>
  );
}
