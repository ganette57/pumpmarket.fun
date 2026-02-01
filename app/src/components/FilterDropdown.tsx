'use client';

import { useState, useRef, useEffect } from 'react';
import { Filter, Check } from 'lucide-react';

type FilterOption = 'all' | 'active' | 'resolved' | 'ending_soon' | 'top_volume';

interface FilterDropdownProps {
  value: FilterOption;
  onChange: (value: FilterOption) => void;
}

export default function FilterDropdown({ value, onChange }: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const options: { value: FilterOption; label: string; icon?: string }[] = [
    { value: 'all', label: 'All Markets' },
    { value: 'active', label: 'Active' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'ending_soon', label: 'Ending Soon', icon: '⏰' },
    { value: 'top_volume', label: 'Top Volume', icon: '🔥' },
  ];

  const selectedOption = options.find((opt) => opt.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-4 py-2 bg-pump-gray hover:bg-pump-dark border border-gray-700 hover:border-pump-green rounded-lg transition text-gray-300 hover:text-white"
      >
        <Filter className="w-4 h-4" />
        <span className="font-medium">
          {selectedOption?.icon && <span className="mr-1">{selectedOption.icon}</span>}
          {selectedOption?.label}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-pump-dark border border-gray-700 rounded-lg shadow-2xl z-50 overflow-hidden animate-fadeIn">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-4 py-3 transition ${
                value === option.value
                  ? 'bg-pump-green/10 text-pump-green'
                  : 'text-gray-300 hover:bg-pump-gray hover:text-white'
              }`}
            >
              <span className="font-medium">
                {option.icon && <span className="mr-2">{option.icon}</span>}
                {option.label}
              </span>
              {value === option.value && <Check className="w-4 h-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
