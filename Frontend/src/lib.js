export const API = window.location.hostname === "localhost" ? "http://localhost:8000" : "http://127.0.0.1:8000";
export const CURRENCY = "$"; // change to "₹" (or any symbol) to re-skin every amount

export const money = (n) =>
  CURRENCY + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

export const compact = (n) => {
  const v = Math.abs(n);
  if (v >= 1e7) return +(n / 1e7).toFixed(1) + "Cr";
  if (v >= 1e5) return +(n / 1e5).toFixed(1) + "L";
  if (v >= 1e3) return +(n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
};

export const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s || "");

export async function api(path, opts = {}) {
  const r = await fetch(API + path, opts);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) {
    const err = new Error((body && body.detail) || text || `Request failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return body;
}

// "2400, 2550, x, 2700" -> numbers, with x / blanks / junk as null (= missing month)
export function parseExpenses(str) {
  const out = [];
  let bad = 0;
  String(str || "").split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean).forEach((tok) => {
    if (/^(x|-|na|n\/a|nan|null)$/i.test(tok)) { out.push(null); return; }
    const n = Number(tok.replace(/[^0-9.\-]/g, ""));
    if (Number.isFinite(n) && /\d/.test(tok)) out.push(n);
    else { out.push(null); bad++; }
  });
  return { values: out, bad, missing: out.filter((v) => v == null).length };
}

// Same formulas the backend feeds to the LLM (computed_facts in main.py)
export function metrics(p) {
  const vals = (p.expenses || []).filter((v) => v != null);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const income = Number(p.income) || 0;
  return {
    avg,
    savingsRate: avg != null && income ? ((income - avg) / income) * 100 : null,
    runway: avg ? (Number(p.savings) || 0) / avg : null,
    dti: income ? ((Number(p.debt) || 0) / (income * 12)) * 100 : null,
    trend: vals.length > 1 ? vals[vals.length - 1] - vals[0] : 0,
    last: vals.length ? vals[vals.length - 1] : null,
  };
}

export const level = (kind, v) => {
  if (v == null) return "na";
  if (kind === "rate") return v >= 20 ? "good" : v >= 10 ? "ok" : "warn";
  if (kind === "runway") return v >= 6 ? "good" : v >= 3 ? "ok" : "warn";
  if (kind === "dti") return v < 36 ? "good" : v <= 50 ? "ok" : "warn";
  return "na";
};
export const LEVEL_TEXT = { good: "Healthy", ok: "Watch", warn: "Needs work", na: "No data" };

export function insights(p, m) {
  const out = [];
  if (m.savingsRate != null) {
    const l = level("rate", m.savingsRate);
    out.push({ tone: l, text: `You save ${m.savingsRate.toFixed(1)}% of income. The usual target is 15–20%.` });
  }
  if (m.runway != null) {
    out.push({ tone: level("runway", m.runway), text: `Your savings cover ${m.runway.toFixed(1)} months of expenses. Aim for 3–6.` });
  }
  if (m.dti != null && Number(p.debt) > 0) {
    out.push({ tone: level("dti", m.dti), text: `Debt equals ${m.dti.toFixed(0)}% of your yearly income.` });
  }
  if (m.trend > 0) out.push({ tone: "ok", text: "Your monthly expenses are trending upward." });
  if (!out.length) out.push({ tone: "na", text: "Add monthly expenses to unlock health checks." });
  return out;
}

export const greet = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
// label the last n entries so the newest one is the current month
export function monthSeries(values, max = 12) {
  const v = values.slice(-max);
  const now = new Date();
  return v.map((value, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (v.length - 1 - i), 1);
    return { label: MONTHS[d.getMonth()], value, year: d.getFullYear() };
  });
}

export const fmtDate = (iso, opts = { day: "2-digit", month: "short", year: "2-digit" }) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", opts) : "—";
export const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";

const SESSION = "fa_session";
export const loadSession = () => { try { return JSON.parse(localStorage.getItem(SESSION)) || null; } catch { return null; } };
export const saveSession = (s) => { try { localStorage.setItem(SESSION, JSON.stringify(s)); } catch { /* ignore */ } };
export const clearSession = () => { try { localStorage.removeItem(SESSION); } catch { /* ignore */ } };
