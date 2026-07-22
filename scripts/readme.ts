import fs from "node:fs/promises";
import path from "node:path";

import { CONFIG, OPPORTUNITIES_PATH } from "@/constants";

import type { JD, Opportunity } from "@/types/jobs";
import type { Config } from "@/validation/config";

import {
  buildCategoryOrder,
  formatCategoryTitle,
  formatLocation,
  getMatchingOpportunities,
  groupByCategory,
  normalizeCompany,
} from "@/modules/job-board";
import { readNdjsonFile } from "@/utils/data";
import { escapeHtml } from "@/utils/html";

type TableRow = [string, string, string, string, string];

const ROOT = process.cwd();

const README_PATH = path.join(ROOT, "README.md");
const ARCHIVE_PATH = path.join(ROOT, "ARCHIVE.md");

const REPO_OWNER = "Donkey0322";
const REPO_NAME = "JobRadar-AI";
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const TEMPLATE_URL = `https://github.com/new?template_name=${REPO_NAME}&template_owner=${REPO_OWNER}`;
const ISSUE_TEMPLATE_URL = `${REPO_URL}/issues/new/choose`;

const BADGE_CITIZENSHIP = `<img height="18" alt="citizen only" src="https://img.shields.io/badge/citizen%20only-ff6b6b?style=plastic" />`;

const BADGE_NO_SPONSORSHIP = `<img height="18" alt="no visa" src="https://img.shields.io/badge/no%20visa-60a5fa?style=plastic" />`;

const APPLY_BUTTON_SRC =
  "https://img.shields.io/badge/Apply-f97316?style=for-the-badge&logoColor=white";

// opportunities.ndjson is append-only and never pruned, so without a cutoff the README
// would grow forever. Data files keep full history; only the rendered board is bounded.
const MAX_AGE_DAYS = 30;

function isWithinMaxAge(job: Opportunity, referenceDate: Date): boolean {
  const posted = new Date(job.postedAt);

  if (Number.isNaN(posted.getTime())) return true;

  const ageMs = referenceDate.getTime() - posted.getTime();
  return ageMs <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

async function main() {
  const opportunities = await readNdjsonFile<Opportunity>(OPPORTUNITIES_PATH);

  const categoryOrder = buildCategoryOrder(CONFIG);
  const generatedAt = new Date();

  // Same eligibility check used for email alerts (country, category, citizenship, sponsorship,
  // intern year), plus role-type exclusions. Both README and ARCHIVE apply this; ARCHIVE just
  // skips the rolling age cutoff, so it's the full history of matching postings.
  const matchingOpportunities = getMatchingOpportunities(opportunities);

  const eligibleOpportunities = matchingOpportunities.filter((job) =>
    isWithinMaxAge(job, generatedAt)
  );

  const grouped = groupByCategory(eligibleOpportunities, categoryOrder);
  const archiveGrouped = groupByCategory(matchingOpportunities, categoryOrder);

  const markdown = buildReadme({
    config: CONFIG,
    opportunities: eligibleOpportunities,
    grouped,
    generatedAt,
  });

  const archiveMarkdown = buildArchive({
    opportunities: matchingOpportunities,
    grouped: archiveGrouped,
    generatedAt,
  });

  await fs.writeFile(README_PATH, markdown, "utf-8");
  await fs.writeFile(ARCHIVE_PATH, archiveMarkdown, "utf-8");

  console.log(`README generated: ${README_PATH}`);
  console.log(`Opportunities included: ${eligibleOpportunities.length}`);
  console.log(`ARCHIVE generated: ${ARCHIVE_PATH}`);
  console.log(`Archive opportunities included: ${matchingOpportunities.length}`);
}

function buildReadme(input: {
  config: Config;
  opportunities: Opportunity[];
  grouped: Map<string, Opportunity[]>;
  generatedAt: Date;
}): string {
  const { config, opportunities, grouped, generatedAt } = input;

  const generatedDate = generatedAt.toISOString().slice(0, 10);

  const aiParser = formatAiParser(config);
  const countries = formatCountries(config);

  const lines: string[] = [];

  lines.push(`# JobRadar AI 🚀`);
  lines.push("");
  lines.push(
    `<p align="center">`,
    `  <b>Fresh tech opportunities from ATS APIs, community lists, and AI-parsed job descriptions.</b>`,
    `</p>`,
    ``,
    `<p align="center">`,
    `  <img src="${formatBadgeUrl("AI Parsed", aiParser, "blue")}" />`,
    `  <img src="${formatBadgeUrl("Countries", countries, "green")}" />`,
    `  <img src="${formatBadgeUrl("Updated", generatedDate, "orange")}" />`,
    `  <img src="${formatBadgeUrl("License", "MIT", "yellow")}" />`,
    `</p>`
  );

  lines.push("");
  lines.push(`---`);
  lines.push("");

  lines.push(
    `<div align="center">`,
    `  <h2>Find better opportunities before everyone else does.</h2>`,
    `  <p>`,
    `    JobRadar AI tracks software, data, AI, infrastructure, security, product, and other tech roles`,
    `    directly from company career systems and community job boards.`,
    `  </p>`,
    `  <p>`,
    `    Instead of being just another manually curated link list, it combines scheduled ATS discovery,`,
    `    community-source sync, job-description crawling, and AI signal parsing into one structured opportunity board.`,
    `  </p>`,
    `</div>`
  );

  lines.push("");
  lines.push(
    `<p align="center">`,
    `  <b>✨ Use the board below — or generate your own personalized tracker.</b>`,
    `</p>`,
    `<p align="center">`,
    `  Bring your own targets, email notifications, schedule, and AI model. Follow`,
    `  <a href="./installation.md"><b>installation.md</b></a> to set it up, or browse the public board below.`,
    `</p>`
  );

  lines.push("");
  lines.push(
    `<p align="center">`,
    `  <a href="${TEMPLATE_URL}">`,
    `    <img alt="Use this template" src="https://img.shields.io/badge/Use%20this%20template-f43f5e?style=for-the-badge" />`,
    `  </a>`,
    `  <a href="./installation.md">`,
    `    <img alt="Setup guide" src="https://img.shields.io/badge/Setup%20guide-f97316?style=for-the-badge" />`,
    `  </a>`,
    `  <a href="./config.json">`,
    `    <img alt="Customize config" src="https://img.shields.io/badge/Customize%20config-f59e0b?style=for-the-badge" />`,
    `  </a>`,
    `  <a href="${ISSUE_TEMPLATE_URL}">`,
    `    <img alt="Contribute a job" src="https://img.shields.io/badge/Contribute%20a%20job-fb7185?style=for-the-badge" />`,
    `  </a>`,
    `</p>`
  );

  lines.push("");
  lines.push(`---`);
  lines.push("");

  lines.push(`## Why JobRadar AI is different`);
  lines.push("");
  lines.push(...buildFeatureGrid());
  lines.push("");

  lines.push(`## The List 🚴‍♂️`);
  lines.push("");
  lines.push(`<!-- TABLE_START -->`);
  lines.push("");

  if (opportunities.length === 0) {
    lines.push(`No opportunities matched the current filters.`);
    lines.push("");
  } else {
    lines.push(...buildCategorySections(grouped));
  }

  lines.push(`<!-- TABLE_END -->`);
  lines.push("");
  lines.push(...buildFooter(generatedAt));

  return lines.join("\n");
}

function buildArchive(input: {
  opportunities: Opportunity[];
  grouped: Map<string, Opportunity[]>;
  generatedAt: Date;
}): string {
  const { opportunities, grouped, generatedAt } = input;

  const lines: string[] = [];

  lines.push(`# JobRadar AI — Full Archive`);
  lines.push("");
  lines.push(
    `Every opportunity matching your current filters (country, category, citizenship/sponsorship, ` +
      `intern year, excluded role types) that JobRadar AI has ever discovered — same filters as ` +
      `[README.md](./README.md), just without the rolling age cutoff.`
  );
  lines.push("");
  lines.push(`<!-- TABLE_START -->`);
  lines.push("");

  if (opportunities.length === 0) {
    lines.push(`No opportunities recorded yet.`);
    lines.push("");
  } else {
    lines.push(...buildCategorySections(grouped));
  }

  lines.push(`<!-- TABLE_END -->`);
  lines.push("");
  lines.push(`---`);
  lines.push("");
  lines.push(
    `📦 Generated from \`opportunities.ndjson\` &nbsp;•&nbsp; 🕒 Last updated \`${generatedAt.toISOString()}\``
  );
  lines.push("");

  return lines.join("\n");
}

function buildCategorySections(grouped: Map<string, Opportunity[]>): string[] {
  const lines: string[] = [];

  for (const [category, jobs] of grouped) {
    lines.push(`### ${formatCategoryTitle(category)}`);
    lines.push("");
    lines.push(...buildOpportunityTable(jobs));
    lines.push("");
  }

  return lines;
}

function buildOpportunityTable(jobs: Opportunity[]): string[] {
  const rows: TableRow[] = [];
  let previousCompany = "";

  for (const job of jobs) {
    const company = normalizeCompany(job.company);
    const companyCell = company === previousCompany ? "↳" : company;
    previousCompany = company;

    rows.push([
      escapeHtml(companyCell),
      formatRoleCell(job),
      escapeHtml(formatLocation(job)),
      formatApplyButton(job.link),
      formatDate(job.postedAt),
    ]);
  }

  return buildHtmlTable(["Company", "Role", "Location", "Link", "Date"], rows);
}

function buildFeatureGrid(): string[] {
  return [
    `<table>`,
    `  <tr>`,
    `    <td width="50%" valign="top">`,
    `      <h3>🔎 Closer to the source</h3>`,
    `      <p>Discovers roles from original ATS and company career APIs, not only reposted or manually submitted links.</p>`,
    `    </td>`,
    `    <td width="50%" valign="top">`,
    `      <h3>⏱️ Built for freshness</h3>`,
    `      <p>Runs on a schedule to keep tracking newly opened opportunities as they appear.</p>`,
    `    </td>`,
    `  </tr>`,
    `  <tr>`,
    `    <td width="50%" valign="top">`,
    `      <h3>🌐 Broader coverage</h3>`,
    `      <p>Combines community lists with Workday, Greenhouse, Ashby, iCIMS, Lever, Oracle Cloud, SmartRecruiters, and more.</p>`,
    `    </td>`,
    `    <td width="50%" valign="top">`,
    `      <h3>🏢 Custom company sources</h3>`,
    `      <p>Adds dedicated sources for high-signal companies like Google, Amazon, Netflix, Apple, Meta, Microsoft, TikTok, and more.</p>`,
    `    </td>`,
    `  </tr>`,
    `  <tr>`,
    `    <td width="50%" valign="top">`,
    `      <h3>🧠 JD-level intelligence</h3>`,
    `      <p>Crawls job descriptions and parses signals like category, country, sponsorship, citizenship, qualifications, and season.</p>`,
    `    </td>`,
    `    <td width="50%" valign="top">`,
    `      <h3>⚙️ Config-driven setup</h3>`,
    `      <p>Tune countries, role targets, email delivery, workflow schedules, and AI model settings through <code>config.json</code>.</p>`,
    `    </td>`,
    `  </tr>`,
    `</table>`,
  ];
}

function buildFooter(generatedAt: Date): string[] {
  return [
    `---`,
    ``,
    `<div align="center">`,
    `  <p>`,
    `    <a href="./ARCHIVE.md"><b>🗄️ Full archive (unfiltered)</b></a>`,
    `    &nbsp;·&nbsp;`,
    `    <a href="./PRIVACY.md"><b>🛡️ Privacy</b></a>`,
    `    &nbsp;·&nbsp;`,
    `    <a href="./SECURITY.md"><b>🔐 Security</b></a>`,
    `    &nbsp;·&nbsp;`,
    `    <a href="./LICENSE"><b>📄 License</b></a>`,
    `  </p>`,
    ``,
    `  <p>`,
    `    <span style="color:#374151;">`,
    `      📦 Generated from <code>opportunities.ndjson</code>`,
    `      &nbsp;•&nbsp;`,
    `      🕒 Last updated <code>${generatedAt.toISOString()}</code>`,
    `    </span>`,
    `  </p>`,
    `</div>`,
    ``,
  ];
}

function formatRoleCell(job: Opportunity): string {
  const role = escapeHtml(job.role);
  const badges = formatJobBadges(job.jd);

  if (!badges) return role;

  return `${role}<br />${badges}`;
}

function formatJobBadges(jd?: JD | null): string {
  if (!jd) return "";

  const badges: string[] = [];

  if (jd.citizenship === true) {
    badges.push(BADGE_CITIZENSHIP);
  }

  if (jd.sponsorship === false) {
    badges.push(BADGE_NO_SPONSORSHIP);
  }

  return badges.join(" ");
}

function formatApplyButton(link: string): string {
  return `<a href="${escapeHtmlAttr(link)}" target="_blank" rel="noopener noreferrer"><img height="28" alt="apply" src="${APPLY_BUTTON_SRC}" /></a>`;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

function buildHtmlTable(headers: TableRow, rows: TableRow[]): string[] {
  const columnWidths = ["180", "420", "180", "120", "100"];

  const lines: string[] = [];

  lines.push(`<table width="100%">`);
  lines.push(`  <thead>`);
  lines.push(`    <tr>`);

  headers.forEach((header, index) => {
    lines.push(
      `      <th width="${columnWidths[index]}" align="left" valign="top">${escapeHtml(
        header
      )}</th>`
    );
  });

  lines.push(`    </tr>`);
  lines.push(`  </thead>`);
  lines.push(`  <tbody>`);

  for (const row of rows) {
    lines.push(`    <tr>`);

    row.forEach((cell, index) => {
      lines.push(`      <td width="${columnWidths[index]}" align="left" valign="top">${cell}</td>`);
    });

    lines.push(`    </tr>`);
  }

  lines.push(`  </tbody>`);
  lines.push(`</table>`);

  return lines;
}

function formatAiParser(config: Config): string {
  if (!config.ai?.enabled) return "disabled";

  const provider = config.ai.provider;
  const model = config.ai.model;

  if (provider && model) {
    return `${provider} / ${model}`;
  }

  return "enabled";
}

function formatCountries(config: Config): string {
  return config.target.countries.join(" · ") || "configured";
}

function formatBadgeUrl(label: string, message: string, color: string): string {
  return `https://img.shields.io/badge/${encodeBadgeSegment(label)}-${encodeBadgeSegment(
    message
  )}-${encodeBadgeSegment(color)}`;
}

function encodeBadgeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("-", "--");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
