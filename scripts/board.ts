import fs from "node:fs/promises";
import path from "node:path";

import { CONFIG, OPPORTUNITIES_PATH } from "@/constants";

import type { JD, Opportunity, RelevanceTier } from "@/types/jobs";
import type { Config } from "@/validation/config";

import {
  buildCategoryOrder,
  formatCategoryTitle,
  formatLocation,
  getMatchingOpportunities,
  getRelevanceTier,
  groupByCategory,
  groupByTier,
  normalizeCompany,
  TIER_LABELS,
} from "@/modules/job-board";
import { readNdjsonFile } from "@/utils/data";
import { escapeHtml } from "@/utils/html";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "dist");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "index.html");

// opportunities.ndjson is append-only and never pruned, so without a cutoff the board
// would grow forever. Same window as the README.
const MAX_AGE_DAYS = 30;

function isWithinMaxAge(job: Opportunity, referenceDate: Date): boolean {
  const posted = new Date(job.postedAt);

  if (Number.isNaN(posted.getTime())) return true;

  const ageMs = referenceDate.getTime() - posted.getTime();
  return ageMs <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return escapeHtml(value);

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function main() {
  const opportunities = await readNdjsonFile<Opportunity>(OPPORTUNITIES_PATH);

  const categoryOrder = buildCategoryOrder(CONFIG);
  const generatedAt = new Date();

  const matchingOpportunities = getMatchingOpportunities(opportunities);
  const eligibleOpportunities = matchingOpportunities.filter((job) =>
    isWithinMaxAge(job, generatedAt)
  );

  const grouped = groupByCategory(eligibleOpportunities, categoryOrder);
  const tierGrouped = groupByTier(eligibleOpportunities);

  const html = buildPage({
    config: CONFIG,
    opportunities: eligibleOpportunities,
    grouped,
    tierGrouped,
    generatedAt,
  });

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_PATH, html, "utf-8");

  console.log(`Board generated: ${OUTPUT_PATH}`);
  console.log(`Opportunities included: ${eligibleOpportunities.length}`);
}

function buildPage(input: {
  config: Config;
  opportunities: Opportunity[];
  grouped: Map<string, Opportunity[]>;
  tierGrouped: Map<RelevanceTier, Opportunity[]>;
  generatedAt: Date;
}): string {
  const { opportunities, grouped, tierGrouped, generatedAt } = input;

  const categoryFilters = buildCategoryFilterBar(grouped);
  const tierFilters = buildTierFilterBar(tierGrouped);

  const sections =
    opportunities.length === 0
      ? `<p class="empty">No opportunities matched the current filters.</p>`
      : Array.from(grouped.entries())
          .map(([category, jobs]) => buildCategorySection(category, jobs))
          .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>JobRadar AI — Job Board</title>
<meta name="description" content="Fresh tech opportunities from ATS APIs, community lists, and AI-parsed job descriptions." />
${STYLE}
</head>
<body>
<main>
  <header>
    <h1>JobRadar AI 🚀</h1>
    <p class="sub">Fresh tech opportunities from ATS APIs, community lists, and AI-parsed job descriptions.</p>
    <p class="meta">🕒 Last updated ${escapeHtml(generatedAt.toISOString())} &nbsp;•&nbsp; <span id="visible-count">${opportunities.length}</span> opportunities</p>
    <p class="meta"><a href="https://github.com/chianosf9251/JobRadar-AI">View the repo</a> — apply links here open in a new tab; the README on GitHub can't (GitHub strips that from rendered markdown).</p>
  </header>
  <button type="button" id="filter-all">All</button>
  <button type="button" id="filter-none">None</button>
${categoryFilters}
${tierFilters}
${sections}
  <footer>
    <p>📦 Generated from <code>opportunities.ndjson</code></p>
  </footer>
</main>
${SCRIPT}
</body>
</html>
`;
}

function buildCategoryFilterBar(grouped: Map<string, Opportunity[]>): string {
  if (grouped.size === 0) return "";

  const chips = Array.from(grouped.keys())
    .map((category) => {
      const slug = slugify(category);
      const label = formatCategoryTitle(category);
      const count = grouped.get(category)!.length;

      return `      <label class="chip">
        <input type="checkbox" data-category="${escapeHtml(slug)}" checked />
        ${escapeHtml(label)} <span class="count">${count}</span>
      </label>`;
    })
    .join("\n");

  return `  <div class="filters" role="group" aria-label="Filter by job type">
    <span class="filters-label">Job type</span>
${chips}
  </div>`;
}

function buildTierFilterBar(grouped: Map<RelevanceTier, Opportunity[]>): string {
  if (grouped.size === 0) return "";

  const chips = Array.from(grouped.keys())
    .map((tier) => {
      const count = grouped.get(tier)!.length;

      return `      <label class="chip">
        <input type="checkbox" data-tier="${escapeHtml(tier)}" checked />
        ${escapeHtml(TIER_LABELS[tier])} <span class="count">${count}</span>
      </label>`;
    })
    .join("\n");

  return `  <div class="filters" role="group" aria-label="Filter by relevance category">
    <span class="filters-label">Category</span>
${chips}
  </div>`;
}

function buildCategorySection(category: string, jobs: Opportunity[]): string {
  let previousCompany = "";

  const rows = jobs
    .map((job) => {
      const company = normalizeCompany(job.company);
      const companyCell = company === previousCompany ? "↳" : company;
      previousCompany = company;

      return buildRow(job, companyCell);
    })
    .join("\n");

  return `  <section data-category="${escapeHtml(slugify(category))}">
    <h2>${escapeHtml(formatCategoryTitle(category))}</h2>
    <table>
      <thead>
        <tr><th>Company</th><th>Role</th><th>Location</th><th>Date</th><th>Link</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>`;
}

function buildRow(job: Opportunity, companyCell: string): string {
  const tier = getRelevanceTier(job);
  const tierLabel = job.jd?.relevanceTier ? ` <span class="tier">${TIER_LABELS[tier]}</span>` : "";

  return `        <tr data-tier="${escapeHtml(tier)}">
          <td>${escapeHtml(companyCell)}</td>
          <td>${escapeHtml(job.role)}${formatBadges(job.jd)}${tierLabel}</td>
          <td>${escapeHtml(formatLocation(job))}</td>
          <td>${formatDate(job.postedAt)}</td>
          <td><a href="${escapeHtml(job.link)}" target="_blank" rel="noopener noreferrer">Apply</a></td>
        </tr>`;
}

function formatBadges(jd?: JD | null): string {
  if (!jd) return "";

  const badges: string[] = [];
  if (jd.citizenship === true) badges.push(`<span class="badge citizen">citizen only</span>`);
  if (jd.sponsorship === false) badges.push(`<span class="badge novisa">no visa</span>`);

  return badges.length ? ` ${badges.join(" ")}` : "";
}

const STYLE = `<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 2rem 1rem; background: #fff; color: #1f2328; }
  @media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3; } }
  main { max-width: 960px; margin: 0 auto; }
  header { margin-bottom: 1.5rem; }
  h1 { margin-bottom: 0.25rem; }
  .sub { opacity: 0.8; margin: 0.25rem 0; }
  .meta { font-size: 0.85rem; opacity: 0.65; margin: 0.25rem 0; }
  #filter-all, #filter-none { font-size: 0.8rem; padding: 0.3rem 0.6rem; border-radius: 6px; border: 1px solid rgba(127,127,127,0.35); background: transparent; color: inherit; cursor: pointer; margin-bottom: 0.75rem; }
  #filter-all:hover, #filter-none:hover { background: rgba(127,127,127,0.1); }
  .filters { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; padding: 0.75rem; border: 1px solid rgba(127,127,127,0.25); border-radius: 8px; }
  .filters-label { font-size: 0.75rem; opacity: 0.55; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 0.25rem; }
  .chip { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.85rem; padding: 0.3rem 0.6rem; border-radius: 6px; background: rgba(127,127,127,0.08); cursor: pointer; user-select: none; }
  .chip input { cursor: pointer; }
  .chip .count { opacity: 0.55; font-size: 0.75rem; }
  section { margin-bottom: 2.5rem; margin-top: 2rem; }
  section.hidden { display: none; }
  tr.hidden { display: none; }
  h2 { border-bottom: 1px solid rgba(127,127,127,0.3); padding-bottom: 0.4rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid rgba(127,127,127,0.15); vertical-align: top; }
  th { opacity: 0.7; font-weight: 600; }
  a { color: #f97316; text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }
  .badge { display: inline-block; font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 4px; margin-left: 0.3rem; }
  .badge.citizen { background: #ff6b6b; color: #fff; }
  .badge.novisa { background: #60a5fa; color: #fff; }
  .tier { font-size: 0.7rem; opacity: 0.6; }
  footer { opacity: 0.6; font-size: 0.8rem; margin-top: 2rem; }
  .empty { opacity: 0.7; }
</style>`;

const SCRIPT = `<script>
(function () {
  var categoryCheckboxes = Array.prototype.slice.call(document.querySelectorAll(".chip input[data-category]"));
  var tierCheckboxes = Array.prototype.slice.call(document.querySelectorAll(".chip input[data-tier]"));
  var allCheckboxes = categoryCheckboxes.concat(tierCheckboxes);
  var sections = Array.prototype.slice.call(document.querySelectorAll("section[data-category]"));
  var countEl = document.getElementById("visible-count");
  var allBtn = document.getElementById("filter-all");
  var noneBtn = document.getElementById("filter-none");

  function activeSet(checkboxes, attr) {
    var active = {};
    checkboxes.forEach(function (cb) {
      if (cb.checked) active[cb.dataset[attr]] = true;
    });
    return active;
  }

  function apply() {
    var activeCategories = activeSet(categoryCheckboxes, "category");
    var activeTiers = activeSet(tierCheckboxes, "tier");

    var visible = 0;
    sections.forEach(function (section) {
      var categoryOn = !!activeCategories[section.dataset.category];
      var rows = Array.prototype.slice.call(section.querySelectorAll("tbody tr"));
      var sectionVisible = 0;

      rows.forEach(function (row) {
        var show = categoryOn && !!activeTiers[row.dataset.tier];
        row.classList.toggle("hidden", !show);
        if (show) sectionVisible++;
      });

      section.classList.toggle("hidden", sectionVisible === 0);
      visible += sectionVisible;
    });

    if (countEl) countEl.textContent = String(visible);
  }

  allCheckboxes.forEach(function (cb) {
    cb.addEventListener("change", apply);
  });

  if (allBtn) {
    allBtn.addEventListener("click", function () {
      allCheckboxes.forEach(function (cb) { cb.checked = true; });
      apply();
    });
  }

  if (noneBtn) {
    noneBtn.addEventListener("click", function () {
      allCheckboxes.forEach(function (cb) { cb.checked = false; });
      apply();
    });
  }

  apply();
})();
</script>`;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
