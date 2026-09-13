// Shared pieces for the static "update tracker" pages in docs/ (Copilot releases, Agentic DevOps).
// Each page script builds its own rows; this module holds the helpers, styles, and filter script they share.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const decodeEntities = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[e]);

// RSS 2.0 <item>s as { url, title, date (ISO), categories, description (plain text), content (HTML) }.
export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const tag = (name) => decodeEntities(item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "").trim();
    const description = tag("description").replace(/<[^>]+>/g, " ").replace(/The post .* appeared first on.*$/s, "");
    return {
      url: tag("link"),
      title: tag("title"),
      date: new Date(tag("pubDate")).toISOString(),
      categories: [...item.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((m) => decodeEntities(m[1]).trim()),
      description: decodeEntities(description).replace(/\s+/g, " ").trim(),
      content: tag("content:encoded"),
    };
  });
}

// Checks one agent-written summary; returns error strings prefixed with `key`.
export function summaryErrors(key, value, { maxWords, maxSentences }) {
  const errors = [];
  const summary = String(value ?? "").trim();
  const words = summary.split(/\s+/).filter(Boolean).length;
  const sentences = summary.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  if (!summary) errors.push(`${key}: summary is empty`);
  if (/[`*#_[\]]|^\s*-\s/.test(summary)) errors.push(`${key}: summary contains Markdown characters`);
  if (words > maxWords) errors.push(`${key}: summary has ${words} words (max ${maxWords})`);
  if (summary && !/[.!?]$/.test(summary)) errors.push(`${key}: summary must end with sentence punctuation`);
  if (sentences > maxSentences) errors.push(`${key}: summary has ${sentences} sentences (max ${maxSentences})`);
  return errors;
}

// Filled or empty squares in front of a status label, e.g. ■■□ PREVIEW.
export const statusSteps = (level) =>
  [1, 2, 3].map((n) => `<i class="${n <= level ? "on" : ""}"></i>`).join("");

export const CSS = `
:root{--bg:#f6f8fa;--card:#fff;--text:#1f2328;--muted:#59636e;--line:#d1d9e0;--blue:#0969da;--blue-soft:#ddf4ff;
--green:#1a7f37;--green-soft:#dafbe1;--purple:#8250df;--purple-soft:#fbefff;--orange:#bc4c00;--orange-soft:#fff1e5;--red:#cf222e;--red-soft:#ffebe9}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif}
a{color:var(--blue);text-underline-offset:2px}
code{font:.875em ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;background:#eff2f5;border-radius:6px;padding:.1em .4em;overflow-wrap:anywhere}
:focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:6px}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.shell{max-width:1120px;margin:0 auto;padding:0 32px 80px}
.hero{padding:64px 0 32px}
.eyebrow{margin:0 0 8px;color:var(--blue);font:700 .8rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase}
h1{margin:0;font-size:clamp(2rem,5vw,3.5rem);line-height:1.1;letter-spacing:-.02em}
.lede{margin:12px 0 0;color:var(--muted);max-width:75ch}
.meta-chips{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 0;padding:0;list-style:none}
.meta-chips li{font:.8rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 14px}
.meta-chips li span{color:var(--muted);margin-right:4px}
.meta-chips a{text-decoration:none}
.meta-chips a:hover{text-decoration:underline}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:0 0 32px}
.stats div{min-width:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px}
.stats dt{color:var(--muted);font:600 .72rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase}
.stats dd{margin:6px 0 0;font-size:1.6rem;font-weight:700;line-height:1.2}
.toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;
padding:16px 0;margin-bottom:24px;background:rgba(246,248,250,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{font:600 .85rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:6px 16px}
.chip span{color:var(--muted);font-weight:500;margin-left:4px}
.chip:hover{border-color:var(--blue)}
.chip[aria-pressed="true"]{background:var(--blue);border-color:var(--blue);color:#fff}
.chip[aria-pressed="true"] span{color:#dbeafe}
.search{position:relative;flex:0 1 360px}
.search::before{content:"⌕";position:absolute;left:12px;top:50%;transform:translateY(-52%);color:var(--muted);font-size:1.1rem;pointer-events:none}
.search input{width:100%;font:inherit;font-size:.95rem;padding:8px 12px 8px 36px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text)}
.expand{font:600 .85rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--blue);border-radius:8px;padding:6px 14px;margin-left:auto}
.expand:hover{border-color:var(--blue)}
.timeline{list-style:none;margin:0;padding:0}
.entry{margin-bottom:16px}
.update{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 1px 2px rgba(31,35,40,.04);transition:border-color .15s,box-shadow .15s}
.update:hover,.update[open]{border-color:#afb8c1;box-shadow:0 4px 16px rgba(31,35,40,.08)}
.row{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,300px) auto;align-items:center;gap:24px;padding:24px 28px;cursor:pointer;list-style:none}
.row::-webkit-details-marker{display:none}
.row h2{margin:0;font-size:1.25rem;line-height:1.35}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.tag{font-size:.85rem;font-weight:500;border-radius:6px;padding:4px 12px;background:#eaeef2;color:var(--text)}
.tag-latest{background:var(--green-soft);color:var(--green)}
.status{display:flex;align-items:center;gap:10px;margin:0;font:700 .78rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.1em;text-transform:uppercase}
.steps{display:inline-flex;gap:4px}
.steps i{width:14px;height:14px;border:1.5px solid currentColor;border-radius:2px}
.steps i.on{background:currentColor}
.status-stable{color:var(--green)}
.status-pre{color:var(--orange)}
.facts{display:flex;flex-wrap:wrap;gap:4px 28px;margin:12px 0 0}
.facts dt{font:700 .72rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--blue)}
.facts dd{margin:2px 0 0;font-size:1.05rem;font-weight:600}
.toggle{position:relative;width:48px;height:48px;border-radius:10px;background:var(--blue);transition:background .15s}
.toggle::before,.toggle::after{content:"";position:absolute;left:50%;top:50%;width:18px;height:2px;background:#fff;transform:translate(-50%,-50%);transition:transform .15s}
.toggle::after{transform:translate(-50%,-50%) rotate(90deg)}
.update[open] .toggle::after{transform:translate(-50%,-50%) rotate(0deg)}
.row:hover .toggle{background:#0550ae}
.detail{border-top:1px solid #eaeef2}
.card-body{padding:20px 28px}
.summary{margin:0;max-width:75ch;font-size:1.02rem}
.label{margin:16px 0 4px;font:600 .72rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.key-changes{margin:0;padding-left:20px;max-width:80ch;color:#31373d}
.key-changes li{margin:6px 0}
.muted{color:var(--muted)}
.command{margin:0;padding:12px 28px;background:#f6f8fa;border-block:1px solid #eaeef2;color:var(--green);font:.85rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;overflow-x:auto;white-space:pre}
.command span{color:var(--muted)}
.all-changes{padding:0 28px;border-bottom:1px solid #eaeef2}
.all-changes>summary{cursor:pointer;padding:14px 0;font-weight:600;color:var(--blue);list-style:none;display:flex;align-items:center;gap:8px}
.all-changes>summary::-webkit-details-marker{display:none}
.all-changes>summary::before{content:"▸";transition:transform .15s}
.all-changes[open]>summary::before{transform:rotate(90deg)}
.all-changes[open]{padding-bottom:20px}
.cl-section{margin-top:12px;padding-left:16px;border-left:3px solid var(--line)}
.cl-section h4{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase}
.cl-section .count{font-size:.75rem;font-weight:600;letter-spacing:0;background:#eff2f5;color:var(--muted);border-radius:999px;padding:0 8px}
.cl-section ul{margin:0;padding-left:20px;max-width:80ch}
.cl-section li{margin:6px 0}
.cl-section li::marker{color:#8c959f}
.tone-new{border-color:var(--green)}.tone-new h4{color:var(--green)}
.tone-improved{border-color:var(--blue)}.tone-improved h4{color:var(--blue)}
.tone-fixed{border-color:var(--purple)}.tone-fixed h4{color:var(--purple)}
.tone-security{border-color:var(--orange)}.tone-security h4{color:var(--orange)}
.tone-removed{border-color:var(--red)}.tone-removed h4{color:var(--red)}
.card-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;padding:14px 28px;color:var(--muted);font:.8rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
.card-foot a{font-weight:600;text-decoration:none}
.card-foot .foot-link{margin-left:auto}
.card-foot a:hover{text-decoration:underline}
.related{margin:0 28px 20px;background:#f6f8fa;border:1px solid #eaeef2;border-radius:12px;padding:14px 18px}
.related h3{margin:0 0 6px;font:600 .72rem ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.related ul{margin:0;padding:0;list-style:none}
.related li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 16px;padding:6px 0}
.related li+li{border-top:1px solid #eaeef2}
.related time{color:var(--muted);font-size:.85rem;white-space:nowrap}
.empty{text-align:center;color:var(--muted);background:var(--card);border:1px dashed var(--line);border-radius:16px;padding:48px 24px}
[hidden]{display:none!important}
@media (max-width:720px){
.shell{padding:0 16px 48px}.hero{padding-top:40px}
.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.stats div{padding:12px 14px}.stats dd{font-size:1.25rem}
.row{grid-template-columns:minmax(0,1fr) auto;gap:16px;padding:18px}
.row-meta{grid-column:1/-1;grid-row:2}
.toggle{grid-column:2;grid-row:1;align-self:start;width:40px;height:40px}
.card-body,.command,.all-changes,.card-foot{padding-inline:18px}
.related{margin-inline:18px}
.expand{margin-left:0}
.search{flex-basis:100%}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;

// Filtering (any element with data-filter), search, and expand/collapse all. Rows are .entry elements
// with data-tags (space-separated filter ids) and data-search (lower-case text).
export const SCRIPT = `
(function () {
  var filters = document.querySelectorAll("[data-filter]");
  var entries = document.querySelectorAll(".entry");
  var input = document.getElementById("q");
  var empty = document.getElementById("empty");
  var filter = "all";
  function apply() {
    var terms = input.value.toLowerCase().split(/\\s+/).filter(Boolean);
    var shown = 0;
    entries.forEach(function (el) {
      var ok = (filter === "all" || el.dataset.tags.split(" ").indexOf(filter) !== -1) &&
        terms.every(function (t) { return el.dataset.search.indexOf(t) !== -1; });
      el.hidden = !ok;
      if (ok) shown++;
    });
    empty.hidden = shown > 0;
  }
  filters.forEach(function (button) {
    button.addEventListener("click", function () {
      filter = button.dataset.filter;
      filters.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.filter === filter)); });
      apply();
    });
  });
  input.addEventListener("input", apply);
  var expand = document.getElementById("expand");
  expand.addEventListener("click", function () {
    var open = expand.getAttribute("aria-pressed") !== "true";
    document.querySelectorAll(".update").forEach(function (d) { d.open = open; });
    expand.setAttribute("aria-pressed", String(open));
    expand.textContent = open ? "Collapse all" : "Expand all";
  });
})();
`;
