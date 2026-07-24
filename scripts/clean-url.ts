import pLimit from "p-limit";

import { OPPORTUNITIES_PATH } from "@/constants";
import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import type { Opportunity } from "@/types/jobs";

import { getRawJD } from "@/modules/jd-analyzer";
import { isDeadLinkError } from "@/modules/jd-analyzer/ats/fetch";
import { getMatchingOpportunities } from "@/modules/job-board";
import { readNdjsonFile, saveOpportunities } from "@/utils/data";
import { renderProgress } from "@/utils/dev";
import { logger } from "@/utils/logger";

const CONCURRENCY = 20;

// Only re-validate links that are actually displayed (README/web board/Obsidian digest
// all derive from getMatchingOpportunities). urls.json accumulates every URL ever seen —
// tens of thousands — but the vast majority already failed eligibility/relevance and are
// never shown anywhere, so checking them is pure wasted network time. This also means
// urls.json itself is left untouched: there's no real benefit to pruning it (its only
// job is "don't re-process the same URL twice"), and rewriting it wholesale was the
// reason this script kept losing races with other data-writing workflows.
async function main() {
  const opportunities = await readNdjsonFile<Opportunity>(OPPORTUNITIES_PATH);
  const matching = getMatchingOpportunities(opportunities);

  logger.info({ count: matching.length }, "🔍 Checking displayed postings for dead links");

  const limit = pLimit(CONCURRENCY);
  let completed = 0;
  const deadUrls = new Set<string>();

  await Promise.all(
    matching.map((job) =>
      limit(async () => {
        const { error } = await getRawJD(job.link, AbortSignal.timeout(5 * 60 * 1000));

        completed++;
        renderProgress(completed, matching.length);

        if (isDeadLinkError(error.code)) {
          deadUrls.add(job.link);
        }
      })
    )
  );

  console.log(
    { checked: matching.length, dead: deadUrls.size },
    `${GREEN_CHECKMARK} Successfully cleaned urls`
  );

  if (deadUrls.size === 0) {
    return;
  }

  const keptOpportunities = opportunities.filter((job) => !deadUrls.has(job.link));
  await saveOpportunities(keptOpportunities, true);
}

// set silent to true
logger.level = "silent";
main().catch((err) => {
  logger.fatal({ err }, `${RED_CROSS} Fatal error`);
  process.exit(1);
});
