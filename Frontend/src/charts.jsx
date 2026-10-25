import { useEffect, useState } from "react";
import { compact } from "./lib.js";

const nice = (max) => {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/* Bar chart in the style of the reference: grey track, violet fill, axis on the left */
export function BarChart({ data, fmt = compact, height = 210, small = false }) {
  const [on, setOn] = useState(false);
  const [hover, setHover] = useState(null);
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id); }, []);
  const vals = data.map((d) => d.value).filter((v) => v != null);
  const top = nice(Math.max(...vals, 1));
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const ticks = [top, top / 2, 0];
  return (
    <div className={"bars" + (small ? " small" : "")} style={{ "--h": height + "px" }}>
      <div className="yaxis">{ticks.map((t) => <span key={t}>{fmt(t)}</span>)}</div>
      <div className="cols">
        {avg != null && (
          <div className="avg" style={{ bottom: `calc(var(--lab) + ${(avg / top).toFixed(4)} * var(--h))` }}>
            <span>avg {fmt(avg)}</span>
          </div>
        )}
        {data.map((d, i) => (
          <div key={i} className="col" tabIndex={0}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            aria-label={`${d.label}: ${d.value == null ? "no data" : fmt(d.value)}`}>
            <div className="track">
              {d.value == null
                ? <span className="nodata" title="Missing month">?</span>
                : <div className="fill" style={{ height: on ? `${(d.value / top) * 100}%` : "0%", transitionDelay: `${i * 40}ms` }} />}
              {hover === i && <div className="tip">{d.value == null ? "No data" : fmt(d.value)}</div>}
            </div>
            <span className="lab">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Messages per day: questions (violet area) vs answers (cyan line) */
export function LineChart({ points }) {
  const [hover, setHover] = useState(null);
  // fill quiet days with zeros so the x-axis is honest (last 60 days at most)
  const days = [];
  if (points.length) {
    const map = Object.fromEntries(points.map((p) => [p.date, p]));
    const end = new Date(points[points.length - 1].date + "T00:00:00");
    let cur = new Date(points[0].date + "T00:00:00");
    const span = Math.round((end - cur) / 864e5);
    if (span > 59) { cur = new Date(end); cur.setDate(cur.getDate() - 59); }
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      days.push(map[key] || { date: key, user: 0, advisor: 0 });
      cur.setDate(cur.getDate() + 1);
    }
  }
  const W = 640, H = 240, pl = 34, pr = 14, pt = 14, pb = 28;
  const n = days.length;
  const max = nice(Math.max(1, ...days.map((p) => Math.max(p.user, p.advisor))));
  const x = (i) => (n === 1 ? pl + (W - pl - pr) / 2 : pl + ((W - pl - pr) * i) / (n - 1));
  const y = (v) => pt + (H - pt - pb) * (1 - v / max);
  const line = (k) => days.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const area = n > 1 ? `${line("user")} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z` : "";
  const labelAt = new Set(n <= 6 ? days.map((_, i) => i) : [0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n - 1]);
  const short = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const h = hover != null ? days[hover] : null;
  return (
    <div className="linechart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Messages per day"
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="gq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--primary)" stopOpacity=".35" />
            <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={pl} x2={W - pr} y1={y(max * t)} y2={y(max * t)} className="grid" />
            <text x={pl - 8} y={y(max * t) + 4} textAnchor="end" className="axis">{compact(max * t)}</text>
          </g>
        ))}
        {area && <path d={area} fill="url(#gq)" />}
        {n > 1 && <path d={line("advisor")} className="l-advisor" />}
        {n > 1 && <path d={line("user")} className="l-user" />}
        {days.map((p, i) => (
          <g key={p.date}>
            {(n <= 31 || hover === i) && <circle cx={x(i)} cy={y(p.user)} r={hover === i ? 5 : 3} className="d-user" />}
            {(n <= 31 || hover === i) && <circle cx={x(i)} cy={y(p.advisor)} r={hover === i ? 5 : 3} className="d-advisor" />}
            {labelAt.has(i) && <text x={x(i)} y={H - 8} textAnchor="middle" className="axis">{short(p.date)}</text>}
            <rect x={x(i) - (W - pl - pr) / Math.max(n, 1) / 2} y={pt} width={(W - pl - pr) / Math.max(n, 1)} height={H - pt - pb}
              fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
      </svg>
      {h && (
        <div className="ltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{short(h.date)}</b>
          <span><i className="sw u" />{h.user} questions</span>
          <span><i className="sw a" />{h.advisor} answers</span>
        </div>
      )}
    </div>
  );
}

export function Donut({ parts, size = 150, center }) {
  const r = 54, C = 2 * Math.PI * r;
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  let acc = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140" width={size} height={size} role="img" aria-label="Questions versus answers">
        <circle cx="70" cy="70" r={r} className="ring-bg" />
        {parts.map((p) => {
          const len = (p.value / total) * C;
          const el = (
            <circle key={p.label} cx="70" cy="70" r={r} fill="none" stroke={p.color} strokeWidth="16"
              strokeDasharray={`${Math.max(len - 2, 0)} ${C - Math.max(len - 2, 0)}`} strokeDashoffset={-acc}
              transform="rotate(-90 70 70)" strokeLinecap="butt" />
          );
          acc += len;
          return el;
        })}
      </svg>
      <div className="donut-c">{center}</div>
    </div>
  );
}

export function Heatmap({ grid }) {
  const max = Math.max(1, ...grid.flat());
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div className="heat" role="img" aria-label="When questions are asked, by weekday and hour">
      <div className="heat-scroll">
        <div className="heat-hours">
          <span />{Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 6 === 0 ? h : ""}</span>)}
        </div>
        {grid.map((row, d) => (
          <div className="heat-row" key={d}>
            <span className="heat-day">{days[d]}</span>
            {row.map((v, h) => (
              <i key={h} title={`${days[d]} ${String(h).padStart(2, "0")}:00 — ${v} question${v === 1 ? "" : "s"}`}
                style={v ? { background: "var(--primary)", opacity: 0.22 + (0.78 * v) / max } : undefined} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const PAL = ["#6a58ef", "#4cc9f0", "#f72585", "#ffb703", "#2ec4b6", "#9d4edd", "#fb8500", "#8a89a8"];
export const palette = (i) => PAL[i % PAL.length];

export function HBars({ items }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id); }, []);
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="hbars">
      {items.map((it, i) => (
        <li key={it.topic}>
          <span className="hb-l">{it.topic}</span>
          <span className="hb-t"><span style={{ width: on ? `${(it.count / max) * 100}%` : 0, background: palette(i), transitionDelay: `${i * 60}ms` }} /></span>
          <b>{it.count}</b>
        </li>
      ))}
    </ul>
  );
}
