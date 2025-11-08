export const CATEGORIES = [
  { id: 'trending', label: 'Trending', icon: '🔥' },
  { id: 'breaking', label: 'Breaking News', icon: '📰' },
  { id: 'politics', label: 'Politics', icon: '🏛️' },
  { id: 'sports', label: 'Sports', icon: '⚽' },
  { id: 'finance', label: 'Finance', icon: '💵' },
  { id: 'crypto', label: 'Crypto', icon: '₿' },
  { id: 'culture', label: 'Culture', icon: '🎭' },
  { id: 'tech', label: 'Tech', icon: '💻' },
  { id: 'science', label: 'Science', icon: '🔬' },
  { id: 'entertainment', label: 'Entertainment', icon: '🎬' },
  { id: 'other', label: 'Other', icon: '📌' },
] as const;

export type CategoryId = typeof CATEGORIES[number]['id'];

export function getCategoryById(id: string) {
  return CATEGORIES.find(cat => cat.id === id);
}

export function getCategoryLabel(id: string): string {
  return getCategoryById(id)?.label || 'Other';
}

export function getCategoryIcon(id: string): string {
  return getCategoryById(id)?.icon || '📌';
}
