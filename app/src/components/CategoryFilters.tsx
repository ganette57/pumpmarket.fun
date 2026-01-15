"use client";

export const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "trending", label: "Trending" },
  { id: "breaking", label: "Breaking news" },
  { id: "politics", label: "Politics" },
  { id: "sports", label: "Sports" },
  { id: "finance", label: "Finance" },
  { id: "crypto", label: "Crypto" },
  { id: "culture", label: "Culture" },
  { id: "tech", label: "Tech" },
  { id: "science", label: "Science" },
  { id: "entertainment", label: "Entertainment" },
  { id: "other", label: "Other" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

interface CategoryFiltersProps {
  selectedCategory: CategoryId;
  onSelectCategory: (id: CategoryId) => void;
}

export default function CategoryFilters({ selectedCategory, onSelectCategory }: CategoryFiltersProps) {
  return (
    <div className="py-4">
<div className="mt-4 flex items-center gap-3 overflow-x-auto">
          {CATEGORIES.map((cat) => {
          const active = selectedCategory === cat.id;

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelectCategory(cat.id)}
              className={[
                "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all",
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
    </div>
  );
}