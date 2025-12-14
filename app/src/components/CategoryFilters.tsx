'use client';

import { motion } from 'framer-motion';
import { CATEGORIES, CategoryId } from '@/utils/categories';

interface CategoryFiltersProps {
  selectedCategory: CategoryId | 'all';
  onSelectCategory: (category: CategoryId | 'all') => void;
}

export default function CategoryFilters({ selectedCategory, onSelectCategory }: CategoryFiltersProps) {
  const allCategories = [{ id: 'all' as const, label: 'All', icon: '🌟' }, ...CATEGORIES];

  return (
    <div className="py-4">
      <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide pb-2">
        {allCategories.map((category, index) => {
          const isSelected = selectedCategory === category.id;

          return (
            <motion.button
              key={category.id}
              onClick={() => onSelectCategory(category.id)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05, duration: 0.3 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm whitespace-nowrap transition-all duration-200
                ${
                  isSelected
                    ? 'bg-pump-green text-black shadow-lg shadow-pump-green/20'
                    : 'bg-pump-gray text-gray-300 border border-gray-700 hover:border-pump-green hover:text-pump-green'
                }
              `}
            >
              <span className="text-lg">{category.icon}</span>
              <span>{category.label}</span>
            </motion.button>
          );
        })}
      </div>

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
