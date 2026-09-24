#!/usr/bin/env node
// Builds docs/copilot-app-releases.html for the github-copilot-apps-news workflow.
//
//   node copilot-releases-page.mjs prepare   raw releases + RSS feed -> compact JSON for the agent
//   node copilot-releases-page.mjs render    compact JSON + agent notes -> static HTML page
//
// Rendering is deterministic: the agent only writes summaries and picks related
// posts in notes.json; everything else (parsing, escaping, layout) happens here.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { CSS, SCRIPT, escapeHtml, fmtDate, parseRss, statusSteps, summaryErrors } from "./lib/update-page.mjs";

const DIR = process.env.RELEASES_DIR || "/tmp/gh-aw/agent";
const RAW_RELEASES = `${DIR}/github-copilot-releases.json`;
const RAW_FEED = `${DIR}/github-changelog.xml`;
const RELEASES = `${DIR}/releases.json`;
const FEED = `${DIR}/changelog-posts.json`;
const NOTES = `${DIR}/notes.json`;
const OUTPUT = process.env.RELEASES_OUTPUT || "docs/copilot-app-releases.html";

const SOURCES = {
  app: {
    label: "GitHub Copilot App",
    short: "App",
    page: "https://github.com/github/app/releases",
    changelog: "https://github.com/github/app/blob/main/changelog.md",
  },
  cli: {
    label: "GitHub Copilot CLI",
    short: "CLI",
    page: "https://github.com/github/copilot-cli/releases",
    changelog: "https://github.com/github/copilot-cli/blob/main/changelog.md",
  },
  sdk: {
    label: "GitHub Copilot SDK",
    short: "SDK",
    page: "https://github.com/github/copilot-sdk/releases",
    changelog: "https://github.com/github/copilot-sdk/blob/main/CHANGELOG.md",
  },
  spec: {
    label: "GitHub Spec Kit",
    short: "Spec Kit",
    page: "https://github.com/github/spec-kit/releases",
    changelog: "https://github.com/github/spec-kit/blob/main/CHANGELOG.md",
  },
  aw: {
    label: "GitHub Agentic Workflows",
    short: "Agentic Workflows",
    page: "https://github.com/github/gh-aw/releases",
    changelog: "https://github.com/github/gh-aw/blob/main/CHANGELOG.md",
  },
};

const isSafeLink = (url) => /^https:\/\/(github\.com|github\.blog)\//.test(url);

// ---------------------------------------------------------------------------
// Release body parsing
// ---------------------------------------------------------------------------

const EMPTY_ITEM = /^(none|n\/a|no details|-+|tbd)\.?$/i;
// Sections that are not product changes (SDK notes end with contributors and install snippets).
const SKIP_SECTION = /^(new contributors|installation|maven|gradle\b.*|full changelog.*)$/i;
// SDK-style "### Feature: rewind support" headings become one item under a "Features" section.
const NAMED_CHANGE = /^(feature|improvement|bugfix|fix|breaking change)s?\s*:\s*(.+)$/i;
const NAMED_SECTION = { feature: "Features", improvement: "Improved", bugfix: "Fixed", fix: "Fixed", "breaking change": "Breaking changes" };

// Returns [{ heading, items: [{ text, children: [text] }] }] with empty sections dropped.
function parseBody(body) {
  const sections = [];
  let current = null;
  let named = null; // the item created by a "Feature: name" heading, which following paragraphs describe
  let skipping = false;
  let inFence = false;
  const open = (heading) => {
    named = null;
    skipping = SKIP_SECTION.test(heading);
    sections.push((current = { heading, items: [] }));
  };

  const lines = String(body || "").replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line || /^\d{4}-\d{2}-\d{2}$/.test(line) || /^(-{3,}|\*{3,})$/.test(line)) continue;

    const heading =
      line.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1] ??
      line.match(/^\*\*([^*]+?):?\*\*:?$/)?.[1] ??
      line.match(/^__([^_]+?):?__:?$/)?.[1];
    if (heading) {
      if (/^what[’'`]?s\s+new\b/i.test(heading)) continue; // document title, not a section
      const change = heading.match(NAMED_CHANGE);
      if (change) {
        const name = NAMED_SECTION[change[1].toLowerCase()];
        if (current?.heading !== name) open(name);
        current.items.push((named = { text: `**${change[2].replace(/\*\*/g, "")}**`, children: [] }));
        continue;
      }
      open(heading.trim());
      continue;
    }
    if (skipping) continue;

    const bullet = raw.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      const text = bullet[2].trim();
      if (!text || EMPTY_ITEM.test(text)) continue;
      if (named) {
        named.children.push(text);
        continue;
      }
      if (!current) open("Changes");
      const last = current.items.at(-1);
      if (bullet[1].length >= 2 && last) last.children.push(text);
      else current.items.push({ text, children: [] });
      continue;
    }

    // A short plain line directly followed by a list reads as a heading ("Fixes and changes").
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (!named && next && /^\s*(?:[-*+]|\d+[.)])\s+/.test(next) && line.length <= 60 && !/[.:!?]$/.test(line)) {
      open(line);
      continue;
    }

    if (EMPTY_ITEM.test(line)) continue;
    if (named) {
      named.text += /\*\*$/.test(named.text) ? ` — ${line}` : ` ${line}`;
      continue;
    }
    const last = current?.items.at(-1);
    if (last && /^\s{2,}/.test(raw)) last.text += ` ${line}`; // wrapped list item
    else {
      if (!current) open("Changes");
      current.items.push({ text: line, children: [] });
    }
  }

  const merged = [];
  for (const s of sections.filter((s) => s.items.length)) {
    const same = merged.find((m) => m.heading.toLowerCase() === s.heading.toLowerCase());
    if (same) same.items.push(...s.items);
    else merged.push(s);
  }
  return merged;
}

// Minimal inline Markdown: `code`, **bold**, [text](https-github-url). Everything else is escaped text.
function inline(md) {
  const out = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m; (m = re.exec(md)); ) {
    out.push(escapeHtml(md.slice(last, m.index)));
    if (m[1] != null) out.push(`<code>${escapeHtml(m[1])}</code>`);
    else if (m[2] != null || m[3] != null) out.push(`<strong>${inline(m[2] ?? m[3])}</strong>`);
    else if (isSafeLink(m[5])) out.push(`<a href="${escapeHtml(m[5])}">${escapeHtml(m[4])}</a>`);
    else out.push(escapeHtml(m[4]));
    last = re.lastIndex;
  }
  out.push(escapeHtml(md.slice(last)));
  return out.join("");
}

const plain = (md) => md.replace(/`([^`]+)`/g, "$1").replace(/\*\*|__/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

// ---------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------

function prepare() {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const raw = JSON.parse(readFileSync(RAW_RELEASES, "utf8"))
    .filter((r) => Date.parse(r.published_at || r.created_at) >= cutoff)
    .sort((a, b) => Date.parse(b.published_at || b.created_at) - Date.parse(a.published_at || a.created_at));
  const releases = raw.map((r) => {
    const source = SOURCES[r.digest_source];
    const date = r.published_at || r.created_at;
    const url = typeof r.html_url === "string" && r.html_url.startsWith(`${source.page}/`) ? r.html_url : source.page;
    return {
      key: `${r.digest_source}:${r.id}`,
      source: r.digest_source,
      title: (r.name || r.tag_name || "Untitled release").trim(),
      tag: r.tag_name,
      prerelease: Boolean(r.prerelease),
      date,
      url,
      sections: parseBody(r.body).map((s) => ({
        heading: s.heading,
        items: s.items.map((it) => ({ text: it.text, children: it.children })),
      })),
    };
  });

  const posts = parseRss(readFileSync(RAW_FEED, "utf8"))
    .map(({ content, ...post }) => post)
    .filter((p) => /^https:\/\/github\.blog\//.test(p.url) && p.title);

  writeFileSync(RELEASES, JSON.stringify(releases, null, 2));
  writeFileSync(FEED, JSON.stringify(posts, null, 2));

  // Blank notes for the agent to fill in; `release` is only there to orient it and is ignored by render.
  const blank = releases.map((r) => [
    r.key,
    { release: `${r.title} (${SOURCES[r.source].short}, ${fmtDate(r.date)})`, summary: "", related: [] },
  ]);
  writeFileSync(NOTES, JSON.stringify(Object.fromEntries(blank), null, 2));
  console.log(`Wrote ${releases.length} releases, ${posts.length} posts, and blank notes to ${DIR}`);
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

const SECTION_TONE = [
  [/highlight|new|added|feature/i, "new"],
  [/improv|changed|update|enhance/i, "improved"],
  [/fix|bug/i, "fixed"],
  [/security/i, "security"],
  [/remov|deprecat|breaking/i, "removed"],
];
const toneFor = (heading) => SECTION_TONE.find(([re]) => re.test(heading))?.[1] ?? "neutral";

function validateNotes(releases, posts, notes) {
  const errors = [];
  const keys = new Set(releases.map((r) => r.key));
  const postUrls = new Set(posts.map((p) => p.url));
  for (const key of Object.keys(notes)) if (!keys.has(key)) errors.push(`${key}: not a release key in ${RELEASES}`);
  for (const r of releases) {
    const note = notes[r.key];
    if (!note) {
      errors.push(`${r.key}: missing entry`);
      continue;
    }
    errors.push(...summaryErrors(r.key, note.summary, { maxWords: 60, maxSentences: 3 }));
    const related = note.related ?? [];
    if (!Array.isArray(related) || related.length > 3) errors.push(`${r.key}: related must be an array of at most 3 URLs`);
    for (const url of Array.isArray(related) ? related : [])
      if (!postUrls.has(url)) errors.push(`${r.key}: related URL is not in ${FEED}: ${url}`);
  }
  return errors;
}

// Up to this many items are pulled onto each card as "Key changes".
const KEY_CHANGES = 4;
const KEY_ORDER = [/highlight/i, /new|added|feature/i, /improv|changed|update|enhance/i, /security|breaking|remov|deprecat/i, /fix|bug/i];

// The release's own Highlights section if it has one; otherwise the top items by section priority.
function keyChanges(sections) {
  const picked = [];
  for (const re of KEY_ORDER) {
    for (const s of sections.filter((s) => re.test(s.heading))) {
      for (const it of s.items) if (picked.length < KEY_CHANGES) picked.push(it);
    }
    if (re === KEY_ORDER[0] && picked.length) break;
  }
  return (picked.length ? picked : (sections[0]?.items ?? []).slice(0, KEY_CHANGES)).map(brief);
}

// "**Feature name** — long description" keeps only the first sentence on the card; "All changes" has the rest.
function brief(item) {
  const m = item.text.match(/^(\*\*.+?\*\*) — (.+)$/);
  if (!m) return item;
  const first = m[2].match(/^.+?[.!?](?=\s+[A-Z]|$)/)?.[0] ?? m[2];
  return { text: `${m[1]} — ${first}`, children: [] };
}

const items = (list) =>
  list
    .map(
      (it) =>
        `\n            <li>${inline(it.text)}${
          it.children.length ? `<ul>${it.children.map((c) => `<li>${inline(c)}</li>`).join("")}</ul>` : ""
        }</li>`,
    )
    .join("");

function renderCard(r, note, postsByUrl, isLatest) {
  const source = SOURCES[r.source];
  const repo = source.page.replace("https://github.com/", "").replace(/\/releases$/, "");
  const itemCount = r.sections.reduce((n, s) => n + s.items.length, 0);
  const searchText = [r.title, r.tag, source.label, note.summary, ...r.sections.flatMap((s) => [s.heading, ...s.items.flatMap((i) => [i.text, ...i.children])])]
    .map(plain)
    .join(" ")
    .toLowerCase();

  const sections = r.sections
    .map(
      (s) => `
          <section class="cl-section tone-${toneFor(s.heading)}">
            <h4>${escapeHtml(plain(s.heading))} <span class="count">${s.items.length}</span></h4>
            <ul>${items(s.items)}
            </ul>
          </section>`,
    )
    .join("");

  const related = (note.related ?? []).map((url) => postsByUrl.get(url));
  const relatedHtml = related.length
    ? `
        <aside class="related" aria-label="Related GitHub posts">
          <h3>Related GitHub posts</h3>
          <ul>${related
            .map(
              (p) => `
            <li><a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a> <time datetime="${p.date.slice(0, 10)}">${fmtDate(p.date)}</time></li>`,
            )
            .join("")}
          </ul>
        </aside>`
    : "";

  const title = /copilot/i.test(r.title) ? r.title : `${source.label} ${r.title}`;
  const status = r.prerelease ? { label: "Prerelease", level: 2 } : { label: "Stable", level: 3 };
  const steps = statusSteps(status.level);

  return `
    <li class="entry" data-tags="${r.source}" data-search="${escapeHtml(searchText)}">
      <details class="update accent-${r.source}" id="${escapeHtml(`${r.source}-${r.tag || r.key}`)}"${isLatest ? " open" : ""}>
        <summary class="row">
          <div class="row-main">
            <h2>${escapeHtml(title)}</h2>
            <div class="tags">${isLatest ? `
              <span class="tag tag-latest">Latest</span>` : ""}
              <span class="tag tag-${r.source}">${source.label}</span>
            </div>
          </div>
          <div class="row-meta">
            <p class="status status-${r.prerelease ? "pre" : "stable"}"><span class="steps" aria-hidden="true">${steps}</span>${status.label}</p>
            <dl class="facts">
              <div><dt>Released</dt><dd><time datetime="${r.date.slice(0, 10)}">${fmtDate(r.date)}</time></dd></div>
              <div><dt>Changes</dt><dd>${itemCount}</dd></div>
            </dl>
          </div>
          <span class="toggle" aria-hidden="true"></span>
        </summary>
        <div class="detail">
          <div class="card-body">
            <p class="summary">${escapeHtml(note.summary)}</p>${
              itemCount
                ? `
            <h3 class="label">Key changes</h3>
            <ul class="key-changes">${items(keyChanges(r.sections))}
            </ul>`
                : `
            <p class="muted">See the official release notes for details.</p>`
            }
          </div>${
            r.tag
              ? `
          <pre class="command"><span aria-hidden="true">$ </span>gh release view ${escapeHtml(r.tag)} --repo ${repo}</pre>`
              : ""
          }${
            itemCount
              ? `
          <details class="all-changes">
            <summary>All ${itemCount} change${itemCount === 1 ? "" : "s"}</summary>${sections}
          </details>`
              : ""
          }
          <footer class="card-foot">
            <span>Source: ${repo}</span><span>Tag: ${escapeHtml(r.tag || "none")}</span>
            <a class="foot-link" href="${source.changelog}">Changelog</a>
            <a href="${escapeHtml(r.url)}">Release notes <span aria-hidden="true">→</span></a>
          </footer>${relatedHtml}
        </div>
      </details>
    </li>`;
}

function render() {
  const releases = JSON.parse(readFileSync(RELEASES, "utf8"));
  const posts = JSON.parse(readFileSync(FEED, "utf8"));
  const notes = existsSync(NOTES) ? JSON.parse(readFileSync(NOTES, "utf8")) : {};

  const errors = validateNotes(releases, posts, notes);
  if (errors.length) {
    console.error(`Fix ${NOTES} and run render again:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }

  const postsByUrl = new Map(posts.map((p) => [p.url, p]));
  const counts = Object.fromEntries(Object.keys(SOURCES).map((k) => [k, 0]));
  for (const r of releases) counts[r.source]++;
  const dates = releases.map((r) => r.date).sort();
  const range = dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates.at(-1))}` : "Last 14 days";
  const changeCount = releases.reduce((n, r) => n + r.sections.reduce((m, s) => m + s.items.length, 0), 0);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Copilot Changelog Tracker</title>
<style>${CSS}${PAGE_CSS}</style>
</head>
<body>
<div class="shell">
  <header class="hero">
    <p class="eyebrow">Copilot changelog tracker</p>
    <h1>GitHub Copilot App, CLI, SDK, Spec Kit &amp; Agentic Workflows Releases</h1>
    <p class="lede">Every GitHub Copilot App, CLI, SDK, Spec Kit, and Agentic Workflows release from the last 14 days, with its key changes and full changelog.</p>
    <ul class="meta-chips">
      <li><span>Range</span> ${range}</li>
${Object.values(SOURCES)
  .map((src) => `      <li><span>${src.short}</span> <a href="${src.page}">Releases</a> · <a href="${src.changelog}">Changelog</a></li>`)
  .join("\n")}
      <li><a href="https://github.blog/changelog/">GitHub Changelog</a></li>
    </ul>
  </header>

  <div class="toolbar" role="search">
    <div class="chips" role="group" aria-label="Filter by product">
      <button type="button" class="chip" data-filter="all" aria-pressed="true">All <span>${releases.length}</span></button>
${Object.entries(SOURCES)
  .map(([key, src]) => `      <button type="button" class="chip" data-filter="${key}" aria-pressed="false">${src.short} <span>${counts[key]}</span></button>`)
  .join("\n")}
    </div>
    <button type="button" class="expand" id="expand" aria-pressed="false">Expand all</button>
    <label class="search">
      <span class="visually-hidden">Search releases</span>
      <input id="q" type="search" placeholder="Search changes, commands, versions…" autocomplete="off">
    </label>
  </div>

  <dl class="stats">
    <div><dt>Products tracked</dt><dd>${Object.keys(SOURCES).length}</dd></div>
    <div><dt>Releases</dt><dd>${releases.length}</dd></div>
    <div><dt>Changes listed</dt><dd>${changeCount}</dd></div>
    <div><dt>Latest release</dt><dd>${dates.length ? fmtDate(dates.at(-1)) : "—"}</dd></div>
  </dl>

  <ol class="timeline" id="timeline">${releases.map((r, i) => renderCard(r, notes[r.key], postsByUrl, i === 0)).join("")}
  </ol>
  <p class="empty" id="empty"${releases.length ? " hidden" : ""}>${releases.length ? "No releases match your filters." : "No App, CLI, SDK, Spec Kit, or Agentic Workflows releases were published in the last 14 days."}</p>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
  writeFileSync(OUTPUT, html);
  console.log(`Wrote ${OUTPUT} (${releases.length} releases)`);
}

const PAGE_CSS = `
.tag-app{background:var(--blue-soft);color:#0550ae}
.tag-cli{background:var(--purple-soft);color:#6639ba}
.tag-sdk{background:var(--orange-soft);color:var(--orange)}
.tag-spec{background:#ffeff7;color:#bf3989}
.tag-aw{background:var(--green-soft);color:var(--green)}
`;

const mode = process.argv[2];
if (mode === "prepare") prepare();
else if (mode === "render") render();
else {
  console.error("Usage: copilot-releases-page.mjs prepare|render");
  process.exit(2);
}
