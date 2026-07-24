import pLimit from "p-limit";

import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import { buildCompanyList } from "@/modules/company-tacker/company";
import { isTarget } from "@/modules/company-tacker/utils";
import { getRawJD } from "@/modules/jd-analyzer";
import { HttpStatusCode, isDeadLinkError } from "@/modules/jd-analyzer/ats/fetch";
import { loadOpportunities, loadUrls, saveOpportunities } from "@/utils/data";
import { saveUrls } from "@/utils/data";
import { renderProgress } from "@/utils/dev";
import { logger } from "@/utils/logger";

const CONCURRENCY = 20;

async function main() {
  const sent = await loadUrls();
  const urls = Array.from(sent);

  const opportunities = await loadOpportunities();

  const untargetedUrls = new Set<string>();
  for (const job of opportunities) {
    if (!isTarget(job.role)) {
      untargetedUrls.add(job.link);
    }
  }

  const limit = pLimit(CONCURRENCY);
  let completed = 0;
  const total = urls.length;

  const deadUrls = new Set<string>();
  const validUrls: string[] = [];

  await Promise.all(
    urls.map((url) =>
      limit(async () => {
        const { error } = await getRawJD(url, AbortSignal.timeout(5 * 60 * 1000));

        completed++;
        renderProgress(completed, total);

        if (untargetedUrls.has(url)) {
          return;
        }

        // Definitively dead (404/410/etc, not just transient): drop from urls.json too,
        // so opportunities.ndjson stays in sync with what's actually still live.
        if (isDeadLinkError(error.code)) {
          deadUrls.add(url);
          return;
        }

        if (!HttpStatusCode.isOk(error.code)) {
          console.error({ url, error }, `${RED_CROSS} Error fetching JD`);
        }

        validUrls.push(url);
      })
    )
  );

  console.log(
    { validUrls: validUrls.length, deadUrls: deadUrls.size, untargeted: untargetedUrls.size },
    `${GREEN_CHECKMARK} Successfully cleaned urls`
  );

  await saveUrls(new Set(validUrls));

  // Previously only urls.json was pruned here — opportunities.ndjson (what the README,
  // web board, and Obsidian digest are actually generated from) never lost dead/untargeted
  // postings, so they stayed visible indefinitely even after being confirmed gone.
  const keptOpportunities = opportunities.filter(
    (job) => !untargetedUrls.has(job.link) && !deadUrls.has(job.link)
  );

  await saveOpportunities(keptOpportunities, true);

  return validUrls;
}

// set silent to true
logger.level = "silent";
main()
  .then((urls) => buildCompanyList(urls))
  .catch((err) => {
    logger.fatal({ err }, `${RED_CROSS} Fatal error`);
    process.exit(1);
  });
