import { CONFIG, JOB_CATEGORIES } from "@/constants";

import type { JD, Opportunity } from "@/types/jobs";
import type { Config } from "@/validation/config";

import { isEligibleJD } from "@/modules/jd-analyzer";

export type JDWithLocation = JD & {
  location?: string | null;
};

// Role types to hide regardless of eligibility (e.g. web/mobile/frontend/backend roles
// that still pass the country/category/citizenship/sponsorship checks). Matched against
// the title only, same as the pre-AI exclude filter in the sync pipeline.
const EXCLUDED_ROLE_KEYWORDS = (CONFIG.target.excludeKeywords ?? []).map((keyword) =>
  keyword.toLowerCase()
);

export function isRenderableOpportunity(job: Opportunity): boolean {
  return Boolean(
    job.company?.trim() &&
      job.role?.trim() &&
      job.link?.trim() &&
      job.postedAt?.trim() &&
      job.jd?.country &&
      job.jd?.category
  );
}

export function matchesExcludedRole(job: Opportunity): boolean {
  if (EXCLUDED_ROLE_KEYWORDS.length === 0) return false;

  const role = job.role.toLowerCase();
  return EXCLUDED_ROLE_KEYWORDS.some((keyword) => role.includes(keyword));
}

/**
 * Renderable opportunities passing the same eligibility check used for email alerts
 * (country, category, citizenship, sponsorship, intern year) plus role-type exclusions.
 * Input is expected in file-append order (oldest first); output is newest first.
 */
export function getMatchingOpportunities(opportunities: Opportunity[]): Opportunity[] {
  return opportunities
    .slice()
    .reverse()
    .filter((job) => isRenderableOpportunity(job))
    .filter((job) => isEligibleJD(job.jd as JD)[0])
    .filter((job) => !matchesExcludedRole(job));
}

export function normalizeCategory(value?: string | null): string {
  const normalized = value?.trim();

  if (!normalized) return "None";

  return normalized.toLowerCase();
}

export function getDisplayCategory(job: Opportunity): string {
  const category = normalizeCategory(job.jd?.category);
  const season = normalizeCategory(job.jd?.season);

  if (category === "intern" && season && season !== "none") {
    return season;
  }

  return category || "None";
}

export function buildTargetCategories(config: Config): string[] {
  return unique([
    ...(config.target.intern ?? []).map(normalizeCategory),
    ...(config.target["full-time"] ?? []).map(normalizeCategory),
  ]);
}

export function buildCategoryOrder(config: Config): string[] {
  return unique([...buildTargetCategories(config), ...JOB_CATEGORIES.map(normalizeCategory)]);
}

export function groupByCategory(
  opportunities: Opportunity[],
  categoryOrder: string[]
): Map<string, Opportunity[]> {
  const groups = new Map<string, Opportunity[]>();

  for (const job of opportunities) {
    const category = getDisplayCategory(job);

    if (!groups.has(category)) {
      groups.set(category, []);
    }

    groups.get(category)!.push(job);
  }

  return sortCategoryGroups(groups, categoryOrder);
}

function sortCategoryGroups(
  groups: Map<string, Opportunity[]>,
  categoryOrder: string[]
): Map<string, Opportunity[]> {
  const knownOrder = new Map(categoryOrder.map((category, index) => [category, index]));

  return new Map(
    [...groups.entries()].sort(([categoryA], [categoryB]) => {
      const orderA = knownOrder.get(categoryA) ?? Number.MAX_SAFE_INTEGER;
      const orderB = knownOrder.get(categoryB) ?? Number.MAX_SAFE_INTEGER;

      if (orderA !== orderB) return orderA - orderB;

      return categoryA.localeCompare(categoryB);
    })
  );
}

export function formatCategoryTitle(category: string): string {
  if (!category || category === "None") return "Other";

  return category
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatLocation(job: Opportunity): string {
  const parsedLocation = (job.jd as JDWithLocation | null | undefined)?.location;
  const location = parsedLocation?.trim() || job.location?.trim();

  if (!location) return "-";

  return location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
}

export function normalizeCompany(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
