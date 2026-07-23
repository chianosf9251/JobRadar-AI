import pLimit from "p-limit";

import { OPPORTUNITIES_PATH } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { JD, Opportunity } from "@/types/jobs";

import getJD from "@/modules/jd-analyzer";
import { HttpStatusCode, NETWORK_ERROR_CODE } from "@/modules/jd-analyzer/ats";
import { getMatchingOpportunities } from "@/modules/job-board";
import { readNdjsonFile, saveOpportunities } from "@/utils/data";
import { renderProgress } from "@/utils/dev";
import { logger } from "@/utils/logger";

const CONCURRENCY = 5;

function isDeadLink(code: number): boolean {
  // A definitive 4xx (excluding 429 rate-limiting) means the posting is gone — safe to
  // prune. Network errors and 5xx are treated as transient/inconclusive and left alone,
  // since a temporarily-down site isn't proof the listing was actually taken down.
  return code !== NETWORK_ERROR_CODE && HttpStatusCode.isError(code) && code < 500;
}

// One-time backfill for opportunities analyzed before the relevant/relevanceTier fields
// existed. Only re-analyzes postings that already pass the current filters (country,
// category, citizenship/sponsorship, intern year, exclude keywords) — not the full
// historical archive — to keep the AI re-analysis cost bounded. Also prunes postings
// whose apply link no longer resolves (job closed/removed).
async function main() {
  const opportunities = await readNdjsonFile<Opportunity>(OPPORTUNITIES_PATH);

  const matching = getMatchingOpportunities(opportunities);
  const needsBackfill = matching.filter((job) => job.jd && !("relevanceTier" in job.jd));

  logger.info({ count: needsBackfill.length }, "🔁 Backfilling relevance for old JDs");

  const limit = pLimit(CONCURRENCY);
  let completed = 0;
  let totalCost = 0;
  let updated = 0;
  let dead = 0;
  let failed = 0;

  const updates = new Map<string, JD>();
  const deadLinks = new Set<string>();

  await Promise.all(
    needsBackfill.map((job) =>
      limit(async () => {
        const result = await getJD(job);

        completed++;
        renderProgress(completed, needsBackfill.length);
        totalCost += result.cost;

        if (result.jd) {
          updates.set(job.link, result.jd);
          updated++;
          return;
        }

        if (isDeadLink(result.error.code)) {
          deadLinks.add(job.link);
          dead++;
          logger.info(
            { company: job.company, role: job.role, url: job.link, code: result.error.code },
            "🗑️ Apply link no longer valid, removing"
          );
          return;
        }

        failed++;
        logger.warn(
          { company: job.company, role: job.role, url: job.link, error: result.error },
          "⚠️ Failed to backfill relevance"
        );
      })
    )
  );

  const patched = opportunities
    .filter((job) => !deadLinks.has(job.link))
    .map((job) => {
      const newJd = updates.get(job.link);
      return newJd ? { ...job, jd: newJd } : job;
    });

  await saveOpportunities(patched, true);

  logger.info({ updated, dead, failed, cost: totalCost }, "💰 Backfill complete");
}

main().catch((err) => {
  logger.fatal({ err }, `${RED_CROSS} Fatal error`);
  process.exit(1);
});
