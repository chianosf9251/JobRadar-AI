import type { COUNTRIES } from "@/constants";
import type { JobCategory } from "@/validation/config";
import type { Season } from "@/validation/season";

// Coarse relevance tiers for sorting (e.g. the Obsidian digest), most-relevant first.
export type RelevanceTier = "gpu-llm-inference" | "mle" | "swe-sde" | "other";

export interface JD {
  citizenship: boolean | null;
  sponsorship: boolean | null;
  qualifications: string[] | null;

  // these fields are added to fill the gap between Job and JD
  country: (typeof COUNTRIES)[number];
  location: string | null;
  category: JobCategory;
  // if category is entry level, mid level, or senior level, season is none
  // if season is not found, return none
  season: Season;
  // true if the JD genuinely matches the configured target domain (target.keywords /
  // target.excludeKeywords), judged by reading the full JD text rather than title
  // substring matching. Second-layer filter on top of the pre-AI keyword filter.
  relevant: boolean;
  // Only meaningful when relevant is true; used to sort/group matching postings by how
  // closely they align with the target domain.
  relevanceTier: RelevanceTier;
}

export interface Job {
  id?: number;
  company: string;
  role: string;
  link: string;
  jd?: JD | null;
  location: string;
}

export interface Opportunity extends Job {
  postedAt: string;
}
