#!/usr/bin/env node
// Builds docs/agentic-devops-releases.html for the agentic-devops workflow.
//
//   node agentic-devops-page.mjs fetch     Azure Updates API + GitHub Changelog + Azure DevOps Blog -> raw files
//   node agentic-devops-page.mjs prepare   raw files -> watchlist updates + blank notes for the agent
//   node agentic-devops-page.mjs render    updates + agent notes -> static HTML page
//
// Rendering is deterministic: the agent only writes a summary per update in notes.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { CSS, SCRIPT, escapeHtml, fmtDate, MONTHS, parseRss, statusSteps, summaryErrors } from "./lib/update-page.mjs";

const DIR = process.env.DEVOPS_DIR || "/tmp/gh-aw/agent";
const OUTPUT = process.env.DEVOPS_OUTPUT || "docs/agentic-devops-releases.html";
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 90);
const RAW = `${DIR}/devops-raw.json`;
const UPDATES = `${DIR}/updates.json`;
const NOTES = `${DIR}/notes.json`;

const SOURCES = {
  azure: { label: "Azure Updates", home: "https://azure.microsoft.com/en-us/updates" },
  github: { label: "GitHub Changelog", home: "https://github.blog/changelog/" },
  devops: { label: "Azure DevOps Blog", home: "https://devblogs.microsoft.com/devops/" },
};

const FEEDS = [
  { source: "github", url: "https://github.blog/changelog/label/copilot/feed/" },
  { source: "github", url: "https://github.blog/changelog/label/application-security/feed/" },
  { source: "devops", url: "https://devblogs.microsoft.com/devops/feed/" },
];

// The watchlist. An update belongs to every topic whose `match` hits its title or opening text.
const TOPICS = [
  { id: "sre-agent", label: "Azure SRE Agent", stars: 5, note: "Closest to real customer value", match: /\bsre agent\b/i },
  {
    id: "resiliency",
    label: "Resiliency Agent",
    stars: 5,
    note: "Strategic, few mature approaches yet",
    match: /resiliency agent|resiliency manager|chaos studio/i,
  },
  {
    id: "coding-agent",
    label: "Copilot Coding Agent",
    stars: 4,
    note: "Delivery agents: important, crowded",
    match: /coding agent|copilot agent|agent sessions?\b|agentic autofix/i,
  },
  { id: "code-review", label: "Copilot Code Review", stars: 4, note: "Delivery agents", match: /copilot code review/i },
  {
    id: "observability",
    label: "Azure Monitor Observability Agent",
    match: /observability agent|troubleshooting agent|azure copilot (agents?|introduces)/i,
  },
  { id: "ado-mcp", label: "Azure DevOps MCP Server", match: /azure devops (remote )?mcp|mcp server[^.]*azure devops/i },
  {
    id: "ado-copilot",
    label: "Copilot in Azure DevOps & Boards",
    match: (text) => /azure devops|azure boards|azure repos/i.test(text) && /copilot|custom agents?/i.test(text),
  },
  {
    id: "ghas",
    label: "GitHub Advanced Security",
    match: /advanced security|code scanning|secret scanning|push protection|copilot autofix|security campaigns?/i,
    exclude: /^CodeQL \d/i, // weekly CodeQL version bumps are noise for a strategy watchlist
  },
];

const topicMatches = (topic, title, text) =>
  !(topic.exclude && topic.exclude.test(title)) &&
  (typeof topic.match === "function" ? topic.match(`${title} ${text}`) : topic.match.test(`${title} ${text}`));

const STATUS = {
  dev: { label: "In development", level: 1, tone: "dev" },
  preview: { label: "Preview", level: 2, tone: "pre" },
  ga: { label: "Generally available", level: 3, tone: "stable" },
  update: { label: "Update", level: 3, tone: "update" },
  retired: { label: "Retirement", level: 0, tone: "retired" },
};

// ---------------------------------------------------------------------------
// HTML description -> plain text
// ---------------------------------------------------------------------------

const toText = (html) =>
  String(html || "")
    .replace(/<(script|style|pre|code)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#8217;|&rsquo;/g, "’")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/\s+/g, " ")
    .trim();

// Opening paragraph (the text before the first list or heading) and up to six list items.
function extract(html) {
  const body = String(html || "").replace(/<!DOCTYPE[^>]*>|<\/?(html|body)[^>]*>/gi, "");
  const intro = toText(body.split(/<(ul|ol|h[1-6])\b/i)[0]).slice(0, 700);
  const points = [...body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => toText(m[1]))
    .filter((t) => t.length > 3)
    .slice(0, 6);
  return { intro, points };
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": "agentic-devops-watchlist" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.text();
}

async function fetchAll() {
  mkdirSync(DIR, { recursive: true });
  const cutoff = Date.now() - WINDOW_DAYS * 864e5;
  const since = new Date(cutoff).toISOString().slice(0, 10);

  const azure = [];
  for (let skip = 0; ; skip += 100) {
    const url =
      "https://www.microsoft.com/releasecommunications/api/v2/azure?" +
      new URLSearchParams({ $filter: `created ge ${since}T00:00:00Z`, $orderby: "created desc", $top: "100", $skip: String(skip) });
    const page = JSON.parse(await get(url)).value;
    azure.push(...page);
    if (page.length < 100) break;
  }

  // WordPress feeds page with ?paged=N; stop once a page reaches past the window.
  const posts = [];
  for (const feed of FEEDS) {
    for (let page = 1; page <= 40; page++) {
      const items = parseRss(await get(`${feed.url}?paged=${page}`));
      posts.push(...items.map((item) => ({ ...item, source: feed.source })));
      if (!items.length || Date.parse(items.at(-1).date) < cutoff) break;
    }
  }

  writeFileSync(RAW, JSON.stringify({ cutoff: new Date(cutoff).toISOString(), azure, posts }));
  console.log(`Fetched ${azure.length} Azure updates and ${posts.length} feed posts into ${RAW}`);
}

// ---------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------

function azureStatus(u) {
  if ((u.tags || []).some((t) => /retire/i.test(t)) || /^retirement/i.test(u.title)) return "retired";
  if (/in development/i.test(u.status || "")) return "dev";
  if (/preview/i.test(u.status || "") || /^(public|private) preview/i.test(u.title)) return "preview";
  if (/launched/i.test(u.status || "") || /^generally avail/i.test(u.title)) return "ga";
  return "update";
}

function postStatus(p) {
  const text = `${p.title} ${p.categories.join(" ")}`;
  if (/retire|deprecat|sunset|closing down/i.test(text)) return "retired";
  if (/preview/i.test(p.title)) return "preview";
  if (/generally available|\bGA\b/i.test(p.title)) return "ga";
  return "update";
}

const month = (ym) => (ym && /^\d{4}-\d{2}/.test(ym) ? `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : null);

function prepare() {
  const raw = JSON.parse(readFileSync(RAW, "utf8"));
  const cutoff = Date.parse(raw.cutoff);
  const updates = [];

  for (const u of raw.azure) {
    const { intro, points } = extract(u.description);
    const topics = TOPICS.filter((t) => topicMatches(t, u.title, intro)).map((t) => t.id);
    if (!topics.length) continue;
    updates.push({
      key: `azure:${u.id}`,
      source: "azure",
      title: u.title.replace(/\s+/g, " ").trim(),
      date: u.created,
      url: `https://azure.microsoft.com/en-us/updates?id=${encodeURIComponent(u.id)}`,
      status: azureStatus(u),
      preview: month(u.previewAvailabilityDate),
      ga: month(u.generalAvailabilityDate),
      products: u.products || [],
      topics,
      intro,
      points,
    });
  }

  const seen = new Set();
  for (const p of raw.posts) {
    const allowed = p.source === "github" ? /^https:\/\/github\.blog\// : /^https:\/\/devblogs\.microsoft\.com\//;
    if (!allowed.test(p.url) || seen.has(p.url) || Date.parse(p.date) < cutoff) continue;
    seen.add(p.url);
    const { intro, points } = extract(p.content || p.description);
    const topics = TOPICS.filter((t) => topicMatches(t, p.title, intro || p.description)).map((t) => t.id);
    if (!topics.length) continue;
    updates.push({
      key: `${p.source}:${p.url.replace(/^https:\/\/[^/]+\//, "").replace(/\/$/, "")}`,
      source: p.source,
      title: p.title,
      date: p.date,
      url: p.url,
      status: postStatus(p),
      preview: null,
      ga: null,
      products: p.categories,
      topics,
      intro: intro || p.description,
      points,
    });
  }

  updates.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  writeFileSync(UPDATES, JSON.stringify(updates, null, 2));

  // Blank notes for the agent; `update` only orients it and is ignored by render.
  const blank = updates.map((u) => [u.key, { update: `${u.title} (${SOURCES[u.source].label}, ${fmtDate(u.date)})`, summary: "" }]);
  writeFileSync(NOTES, JSON.stringify(Object.fromEntries(blank), null, 2));
  const counts = Object.fromEntries(TOPICS.map((t) => [t.id, updates.filter((u) => u.topics.includes(t.id)).length]));
  console.log(`Wrote ${updates.length} watchlist updates and blank notes to ${DIR}`, counts);
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

function validateNotes(updates, notes) {
  const errors = [];
  const keys = new Set(updates.map((u) => u.key));
  for (const key of Object.keys(notes)) if (!keys.has(key)) errors.push(`${key}: not an update key in ${UPDATES}`);
  for (const u of updates) {
    if (!notes[u.key]) errors.push(`${u.key}: missing entry`);
    else errors.push(...summaryErrors(u.key, notes[u.key].summary, { maxWords: 45, maxSentences: 2 }));
  }
  return errors;
}

const stars = (n) => (n ? `<span class="stars" aria-label="${n} out of 5">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>` : "");
const topicById = Object.fromEntries(TOPICS.map((t) => [t.id, t]));

function renderRow(u, note, isLatest) {
  const status = STATUS[u.status];
  const source = SOURCES[u.source];
  const searchText = [u.title, source.label, note.summary, u.intro, ...u.points, ...u.products, ...u.topics.map((id) => topicById[id].label)]
    .join(" ")
    .toLowerCase();
  const facts = [
    u.preview && ["Preview", u.preview],
    u.ga && ["GA", u.ga],
    ["Published", `<time datetime="${u.date.slice(0, 10)}">${fmtDate(u.date)}</time>`],
  ].filter(Boolean);

  return `
    <li class="entry" data-tags="${u.topics.join(" ")}" data-search="${escapeHtml(searchText)}">
      <details class="update" id="${escapeHtml(u.key.replace(/[^a-z0-9-]+/gi, "-"))}"${isLatest ? " open" : ""}>
        <summary class="row">
          <div class="row-main">
            <h2>${escapeHtml(u.title)}</h2>
            <div class="tags">${isLatest ? `
              <span class="tag tag-latest">Latest</span>` : ""}${u.topics
                .map((id) => `
              <span class="tag tag-topic">${escapeHtml(topicById[id].label)}</span>`)
                .join("")}
              <span class="tag tag-source-${u.source}">${source.label}</span>
            </div>
          </div>
          <div class="row-meta">
            <p class="status status-${status.tone}"><span class="steps" aria-hidden="true">${statusSteps(status.level)}</span>${status.label}</p>
            <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
          </div>
          <span class="toggle" aria-hidden="true"></span>
        </summary>
        <div class="detail">
          <div class="card-body">
            <p class="summary">${escapeHtml(note.summary)}</p>${
              u.points.length
                ? `
            <h3 class="label">Key points</h3>
            <ul class="key-changes">${u.points.map((p) => `\n              <li>${escapeHtml(p)}</li>`).join("")}
            </ul>`
                : ""
            }${
              u.intro
                ? `
            <h3 class="label">From the announcement</h3>
            <p class="excerpt">${escapeHtml(u.intro)}</p>`
                : ""
            }
          </div>
          <footer class="card-foot">
            <span>Source: ${source.label}</span>${u.products.length ? `<span>${escapeHtml(u.products.slice(0, 3).join(", "))}</span>` : ""}
            <a class="foot-link" href="${escapeHtml(u.url)}">Read the update <span aria-hidden="true">→</span></a>
          </footer>
        </div>
      </details>
    </li>`;
}

function render() {
  const updates = JSON.parse(readFileSync(UPDATES, "utf8"));
  const notes = existsSync(NOTES) ? JSON.parse(readFileSync(NOTES, "utf8")) : {};
  const errors = validateNotes(updates, notes);
  if (errors.length) {
    console.error(`Fix ${NOTES} and run render again:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }

  const count = (pred) => updates.filter(pred).length;
  const dates = updates.map((u) => u.date).sort();
  const range = dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates.at(-1))}` : `Last ${WINDOW_DAYS} days`;

  const watchlist = TOPICS.map((t) => {
    const mine = updates.filter((u) => u.topics.includes(t.id));
    return `
      <li><button type="button" class="watch" data-filter="${t.id}" aria-pressed="false">
        <span class="watch-name">${escapeHtml(t.label)}</span>${stars(t.stars)}
        <span class="watch-note">${t.note ? escapeHtml(t.note) : "&nbsp;"}</span>
        <span class="watch-count"><strong>${mine.length}</strong> update${mine.length === 1 ? "" : "s"}${mine.length ? ` · latest ${fmtDate(mine[0].date)}` : ""}</span>
      </button></li>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agentic DevOps Watchlist</title>
<style>${CSS}${PAGE_CSS}</style>
</head>
<body>
<div class="shell">
  <header class="hero">
    <p class="eyebrow">Agentic DevOps watchlist</p>
    <h1>Agentic DevOps Updates</h1>
    <p class="lede">Azure, GitHub, and Azure DevOps announcements from the last ${WINDOW_DAYS} days for the agents and platform tools on the watchlist.</p>
    <ul class="meta-chips">
      <li><span>Range</span> ${range}</li>
${Object.values(SOURCES)
  .map((s) => `      <li><a href="${s.home}">${s.label}</a></li>`)
  .join("\n")}
    </ul>
  </header>

  <section aria-labelledby="watchlist-heading">
    <h2 class="section-label" id="watchlist-heading">Watchlist</h2>
    <ul class="watchlist">${watchlist}
    </ul>
  </section>

  <div class="toolbar" role="search">
    <div class="chips" role="group" aria-label="Filter by topic">
      <button type="button" class="chip" data-filter="all" aria-pressed="true">All <span>${updates.length}</span></button>${TOPICS.map(
        (t) => `
      <button type="button" class="chip" data-filter="${t.id}" aria-pressed="false">${escapeHtml(t.label)} <span>${count((u) => u.topics.includes(t.id))}</span></button>`,
      ).join("")}
    </div>
    <button type="button" class="expand" id="expand" aria-pressed="false">Expand all</button>
    <label class="search">
      <span class="visually-hidden">Search updates</span>
      <input id="q" type="search" placeholder="Search agents, services, features…" autocomplete="off">
    </label>
  </div>

  <dl class="stats">
    <div><dt>Topics tracked</dt><dd>${TOPICS.length}</dd></div>
    <div><dt>Updates</dt><dd>${updates.length}</dd></div>
    <div><dt>Generally available</dt><dd>${count((u) => u.status === "ga")}</dd></div>
    <div><dt>In preview</dt><dd>${count((u) => u.status === "preview")}</dd></div>
  </dl>

  <ol class="timeline" id="timeline">${updates.map((u, i) => renderRow(u, notes[u.key], i === 0)).join("")}
  </ol>
  <p class="empty" id="empty"${updates.length ? " hidden" : ""}>${updates.length ? "No updates match your filters." : `No watchlist updates were published in the last ${WINDOW_DAYS} days.`}</p>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
  writeFileSync(OUTPUT, html);
  console.log(`Wrote ${OUTPUT} (${updates.length} updates)`);
}

const PAGE_CSS = `
.chips{max-width:100%}
.tag-topic{background:var(--blue-soft);color:#0550ae}
.tag-source-azure{background:#eaeef2;color:var(--text)}
.tag-source-github{background:var(--purple-soft);color:#6639ba}
.tag-source-devops{background:var(--orange-soft);color:var(--orange)}
.status-dev{color:var(--muted)}
.status-update{color:var(--blue)}
.status-retired{color:var(--red)}
.excerpt{margin:0;max-width:75ch;color:var(--muted)}
.section-label{margin:0 0 12px;font:600 .72rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.watchlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin:0 0 32px;padding:0;list-style:none}
.watch{display:flex;flex-direction:column;gap:4px;width:100%;height:100%;text-align:left;font:inherit;color:var(--text);cursor:pointer;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.watch:hover{border-color:var(--blue)}
.watch[aria-pressed="true"]{border-color:var(--blue);box-shadow:inset 0 0 0 1px var(--blue)}
.watch-name{font-weight:600;line-height:1.3}
.stars{color:#bf8700;letter-spacing:.1em;font-size:.9rem}
.watch-note{color:var(--muted);font-size:.85rem}
.watch-count{margin-top:auto;padding-top:6px;font:.78rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;color:var(--muted)}
.watch-count strong{color:var(--text)}
`;

const mode = process.argv[2];
if (mode === "fetch") await fetchAll();
else if (mode === "prepare") prepare();
else if (mode === "render") render();
else {
  console.error("Usage: agentic-devops-page.mjs fetch|prepare|render");
  process.exit(2);
}
