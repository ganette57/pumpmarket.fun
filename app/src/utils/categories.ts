// src/utils/categories.ts

export const SPORT_SUBCATEGORIES = [
  { id: "football", label: "Football" },
  { id: "basketball", label: "Basketball" },
  { id: "hockey", label: "Hockey" },
  { id: "soccer", label: "Soccer" },
  { id: "tennis", label: "Tennis" },
  { id: "golf", label: "Golf" },
  { id: "mma", label: "MMA" },
  { id: "cricket", label: "Cricket" },
  { id: "baseball", label: "Baseball" },
  { id: "boxing", label: "Boxing" },
  { id: "chess", label: "Chess" },
  { id: "esports", label: "Esports" },
  { id: "motorsport", label: "Motorsport" },
  { id: "olympics", label: "Olympics" },
] as const;

export type SportSubcategoryId = (typeof SPORT_SUBCATEGORIES)[number]["id"];

export const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "trending", label: "Trending" },
  { id: "breaking", label: "Breaking news" },
  { id: "politics", label: "Politics" },
  { id: "sports", label: "Sports", hasSubmenu: true },
  { id: "finance", label: "Finance" },
  { id: "crypto", label: "Crypto" },
  { id: "culture", label: "Culture" },
  { id: "tech", label: "Tech" },
  { id: "science", label: "Science" },
  { id: "entertainment", label: "Entertainment" },
  { id: "other", label: "Other" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

// Helper to check if a category is a sport subcategory
export function isSportSubcategory(id: string): id is SportSubcategoryId {
  return SPORT_SUBCATEGORIES.some((s) => s.id === id);
}

// Helper to get all valid category IDs (including sport subcategories)
export function getAllCategoryIds(): string[] {
  const mainIds = CATEGORIES.map((c) => c.id);
  const sportIds = SPORT_SUBCATEGORIES.map((s) => s.id);
  return [...mainIds, ...sportIds];
}