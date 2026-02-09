"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

// ============ CATEGORIES DATA ============
export const SPORT_SUBCATEGORIES = [
  { id: "soccer", label: "Soccer" },
  { id: "basketball", label: "Basketball" },
  { id: "tennis", label: "Tennis" },
  { id: "mma", label: "MMA" },
  { id: "american_football", label: "American Football" },
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

export function isSportSubcategory(id: string): id is SportSubcategoryId {
  return SPORT_SUBCATEGORIES.some((s) => s.id === id);
}

// ============ COMPONENT ============
export type SelectedCategory = CategoryId | SportSubcategoryId;

interface CategoryFiltersProps {
  selectedCategory: SelectedCategory;
  onSelectCategory: (id: SelectedCategory) => void;
}

export default function CategoryFilters({ selectedCategory, onSelectCategory }: CategoryFiltersProps) {
  const [sportsExpanded, setSportsExpanded] = useState(false);

  const isSelectedSport = isSportSubcategory(selectedCategory);
  
  // Auto-expand if a sport is selected
  const showSportsBar = sportsExpanded || isSelectedSport || selectedCategory === "sports";

  return (
    <div className="py-3">
      {/* Main categories row */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
        {CATEGORIES.map((cat) => {
          // Sports button with toggle
          if (cat.id === "sports") {
            const isSportsActive = selectedCategory === "sports" || isSelectedSport;

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  // Toggle expand/collapse
                  if (showSportsBar) {
                    // If clicking while expanded, select "All Sports" and collapse
                    if (!isSportsActive) {
                      onSelectCategory("sports");
                    }
                    setSportsExpanded(!sportsExpanded);
                  } else {
                    // Expand and select "All Sports"
                    setSportsExpanded(true);
                    onSelectCategory("sports");
                  }
                }}
                className={[
                  "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all flex-shrink-0",
                  "border flex items-center gap-1.5",
                  isSportsActive
                    ? "bg-pump-green text-black border-pump-green shadow-[0_0_24px_rgba(34,197,94,0.35)]"
                    : "bg-[#111111] text-gray-200 border-gray-800 hover:border-gray-600 hover:bg-[#151515]",
                ].join(" ")}
              >
                <span>{cat.label}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${showSportsBar ? "rotate-180" : ""}`}
                />
              </button>
            );
          }

          // Regular category button
          const active = selectedCategory === cat.id;

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                onSelectCategory(cat.id);
                // Collapse sports bar when selecting non-sport category
                setSportsExpanded(false);
              }}
              className={[
                "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all flex-shrink-0",
                "border",
                active
                  ? "bg-pump-green text-black border-pump-green shadow-[0_0_24px_rgba(34,197,94,0.35)]"
                  : "bg-[#111111] text-gray-200 border-gray-800 hover:border-gray-600 hover:bg-[#151515]",
              ].join(" ")}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Sports subcategories row (horizontal bar) */}
      {showSportsBar && (
        <div className="mt-3 pt-3 border-t border-gray-800/50">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {/* All Sports pill */}
            <button
              type="button"
              onClick={() => onSelectCategory("sports")}
              className={[
                "whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-all flex-shrink-0",
                "border",
                selectedCategory === "sports"
                  ? "bg-white/10 text-white border-white/30"
                  : "bg-transparent text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-200",
              ].join(" ")}
            >
              All Sports
            </button>

            {/* Divider */}
            <div className="w-px h-4 bg-gray-700 flex-shrink-0" />

            {/* Sport subcategories */}
            {SPORT_SUBCATEGORIES.map((sport) => (
              <button
                key={sport.id}
                type="button"
                onClick={() => onSelectCategory(sport.id)}
                className={[
                  "whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-all flex-shrink-0",
                  "border",
                  selectedCategory === sport.id
                    ? "bg-white/10 text-white border-white/30"
                    : "bg-transparent text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-200",
                ].join(" ")}
              >
                {sport.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}