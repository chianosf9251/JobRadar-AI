import { CONFIG, JOB_CATEGORIES } from "@/constants";

import type { JD, Opportunity, RelevanceTier } from "@/types/jobs";
import type { Config } from "@/validation/config";

import { isEligibleJD } from "@/modules/jd-analyzer";

export type JDWithLocation = JD & {
  location?: string | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a case-insensitive whole-word/phrase matcher. Plain substring matching breaks
 * for short keywords (e.g. "UI" would match inside "Build", "Guide", "Require", "Liquid"),
 * so each keyword is matched at letter-boundaries instead. Regex `\b` isn't used here because
 * it treats digits as word characters, so `\bpower\b` would miss "Power2 Management Program".
 */
export function buildKeywordMatcher(keywords: string[]): (text: string) => boolean {
  if (keywords.length === 0) return () => false;

  const patterns = keywords.map(
    (keyword) => new RegExp(`(?<![a-zA-Z])${escapeRegExp(keyword)}(?![a-zA-Z])`, "i")
  );
  return (text: string) => patterns.some((pattern) => pattern.test(text));
}

// Role types to hide regardless of eligibility (e.g. web/mobile/frontend/backend roles
// that still pass the country/category/citizenship/sponsorship checks). Matched against
// the title only, same as the pre-AI exclude filter in the sync pipeline.
const matchesExcludedRoleKeyword = buildKeywordMatcher(CONFIG.target.excludeKeywords ?? []);

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
  return matchesExcludedRoleKeyword(job.role);
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

// Most-relevant first, per the AI's relevanceTier judgment.
export const TIER_ORDER: RelevanceTier[] = ["gpu-llm-inference", "mle", "swe-sde", "other"];

export const TIER_LABELS: Record<RelevanceTier, string> = {
  "gpu-llm-inference": "🚀 GPU / LLM Inference",
  mle: "🧠 MLE",
  "swe-sde": "⚙️ SWE / SDE",
  other: "📦 Other",
};

export function getRelevanceTier(job: Opportunity): RelevanceTier {
  return job.jd?.relevanceTier ?? "other";
}

export function groupByTier(opportunities: Opportunity[]): Map<RelevanceTier, Opportunity[]> {
  const groups = new Map<RelevanceTier, Opportunity[]>();

  for (const tier of TIER_ORDER) {
    groups.set(tier, []);
  }

  for (const job of opportunities) {
    groups.get(getRelevanceTier(job))!.push(job);
  }

  for (const tier of TIER_ORDER) {
    if (groups.get(tier)!.length === 0) {
      groups.delete(tier);
    }
  }

  return groups;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
