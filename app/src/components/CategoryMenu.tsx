'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { CATEGORIES, CategoryId } from '@/utils/categories';

interface CategoryMenuProps {
  selectedCategory: CategoryId | 'all';
  onSelectCategory: (category: CategoryId | 'all') => void;
}

export default function CategoryMenu({ selectedCategory, onSelectCategory }: CategoryMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      {/* Desktop - Horizontal Menu */}
      <div className="hidden md:flex items-center space-x-2 overflow-x-auto scrollbar-hide pb-2">
        <button
          onClick={() => onSelectCategory('all')}
          className={`px-4 py-2 rounded-lg font-semibold whitespace-nowrap transition ${
            selectedCategory === 'all'
              ? 'bg-pump-green text-black'
              : 'bg-pump-gray text-gray-400 hover:text-white hover:bg-pump-dark'
          }`}
        >
          All
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onSelectCategory(cat.id)}
            className={`px-4 py-2 rounded-lg font-semibold whitespace-nowrap transition flex items-center space-x-2 ${
              selectedCategory === cat.id
                ? 'bg-pump-green text-black'
                : 'bg-pump-gray text-gray-400 hover:text-white hover:bg-pump-dark'
            }`}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* Mobile - Dropdown */}
      <div className="md:hidden">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-pump-gray border border-gray-700 rounded-lg text-white"
        >
          <span className="flex items-center space-x-2">
            <span>
              {selectedCategory === 'all'
                ? '📂'
                : CATEGORIES.find((c) => c.id === selectedCategory)?.icon}
            </span>
            <span className="font-semibold">
              {selectedCategory === 'all'
                ? 'All Categories'
                : CATEGORIES.find((c) => c.id === selectedCategory)?.label}
            </span>
          </span>
          <ChevronDown
            className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && (
          <div className="absolute top-full mt-2 w-full bg-pump-gray border border-gray-700 rounded-lg shadow-2xl overflow-hidden z-50 animate-slideDown">
            <button
              onClick={() => {
                onSelectCategory('all');
                setIsOpen(false);
              }}
              className={`w-full px-4 py-3 text-left hover:bg-pump-dark transition ${
                selectedCategory === 'all' ? 'bg-pump-green text-black' : 'text-gray-400'
              }`}
            >
              📂 All Categories
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  onSelectCategory(cat.id);
                  setIsOpen(false);
                }}
                className={`w-full px-4 py-3 text-left hover:bg-pump-dark transition flex items-center space-x-2 ${
                  selectedCategory === cat.id ? 'bg-pump-green text-black' : 'text-gray-400'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
