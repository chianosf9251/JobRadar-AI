import fs from "node:fs/promises";
import path from "node:path";

import { CONFIG, OPPORTUNITIES_PATH } from "@/constants";

import type { Opportunity } from "@/types/jobs";

import {
  buildCategoryOrder,
  formatCategoryTitle,
  formatLocation,
  getMatchingOpportunities,
  groupByCategory,
  normalizeCompany,
} from "@/modules/job-board";
import { loadObsidianDigestState, readNdjsonFile, saveObsidianDigestState } from "@/utils/data";
import { logger } from "@/utils/logger";

const ROOT = process.cwd();

// Handoff artifact for the workflow step that pushes into the Obsidian vault repo.
// Not meant to be committed to this repo (see .gitignore).
export const DIGEST_OUTPUT_PATH = path.join(ROOT, "data", "obsidian-digest.md");

// First run (no prior state file) covers the last 24h rather than dumping every
// currently matching opportunity into one note.
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildDigestTable(jobs: Opportunity[]): string[] {
  const lines: string[] = [`| Company | Role | Location | Link |`, `|---|---|---|---|`];

  let previousCompany = "";
  for (const job of jobs) {
    const company = normalizeCompany(job.company);
    const companyCell = company === previousCompany ? "↳" : company;
    previousCompany = company;

    lines.push(
      `| ${escapeTableCell(companyCell)} | ${escapeTableCell(job.role)} | ` +
        `${escapeTableCell(formatLocation(job))} | [Apply](${job.link}) |`
    );
  }

  return lines;
}

function buildDigestMarkdown(input: {
  dateLabel: string;
  opportunities: Opportunity[];
  grouped: Map<string, Opportunity[]>;
}): string {
  const { dateLabel, opportunities, grouped } = input;

  const lines: string[] = [
    `---`,
    `date: ${dateLabel}`,
    `tags: [job-market, jobradar]`,
    `count: ${opportunities.length}`,
    `---`,
    ``,
    `# Job Market — ${dateLabel}`,
    ``,
  ];

  for (const [category, jobs] of grouped) {
    lines.push(`## ${formatCategoryTitle(category)}`, ``, ...buildDigestTable(jobs), ``);
  }

  return lines.join("\n");
}

export default async function generateObsidianDigest() {
  const opportunities = await readNdjsonFile<Opportunity>(OPPORTUNITIES_PATH);
  const matchingOpportunities = getMatchingOpportunities(opportunities);

  const generatedAt = new Date();
  const state = await loadObsidianDigestState();
  const sinceAt = state
    ? new Date(state.lastRunAt)
    : new Date(generatedAt.getTime() - FIRST_RUN_LOOKBACK_MS);

  const newOpportunities = matchingOpportunities.filter(
    (job) => new Date(job.postedAt).getTime() > sinceAt.getTime()
  );

  // Always advance the cursor, even on a no-new-positions run, so tomorrow's window
  // starts from today rather than re-scanning an ever-growing backlog.
  await saveObsidianDigestState({ lastRunAt: generatedAt.toISOString() });

  // Clear any stale digest from a previous run before deciding whether to write a new one.
  await fs.rm(DIGEST_OUTPUT_PATH, { force: true });

  if (newOpportunities.length === 0) {
    logger.info("📭 No new positions since last digest");
    return;
  }

  const categoryOrder = buildCategoryOrder(CONFIG);
  const grouped = groupByCategory(newOpportunities, categoryOrder);
  const dateLabel = generatedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });

  const markdown = buildDigestMarkdown({ dateLabel, opportunities: newOpportunities, grouped });

  await fs.mkdir(path.dirname(DIGEST_OUTPUT_PATH), { recursive: true });
  await fs.writeFile(DIGEST_OUTPUT_PATH, markdown, "utf-8");

  logger.info(
    { count: newOpportunities.length, path: DIGEST_OUTPUT_PATH },
    "📓 Generated Obsidian daily digest"
  );
}
