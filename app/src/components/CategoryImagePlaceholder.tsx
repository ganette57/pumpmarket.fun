'use client';

import { CategoryId } from '@/utils/categories';
import { Bitcoin, TrendingUp, Trophy, DollarSign, Landmark, Zap, Globe, Newspaper, Sparkles } from 'lucide-react';

interface CategoryImagePlaceholderProps {
  category?: string;
  className?: string;
}

export default function CategoryImagePlaceholder({ category, className = '' }: CategoryImagePlaceholderProps) {
  const getCategoryConfig = (cat?: string) => {
    switch (cat) {
      case 'crypto':
        return {
          icon: Bitcoin,
          gradient: 'from-orange-500 to-yellow-500',
          emoji: '₿',
        };
      case 'politics':
        return {
          icon: Landmark,
          gradient: 'from-blue-600 to-indigo-600',
          emoji: '🏛️',
        };
      case 'sports':
        return {
          icon: Trophy,
          gradient: 'from-green-500 to-emerald-500',
          emoji: '⚽',
        };
      case 'finance':
        return {
          icon: DollarSign,
          gradient: 'from-green-600 to-teal-600',
          emoji: '💵',
        };
      case 'breaking':
        return {
          icon: Newspaper,
          gradient: 'from-red-500 to-pink-500',
          emoji: '📰',
        };
      case 'trending':
        return {
          icon: TrendingUp,
          gradient: 'from-pump-green to-green-400',
          emoji: '🔥',
        };
      case 'tech':
        return {
          icon: Zap,
          gradient: 'from-purple-500 to-pink-500',
          emoji: '⚡',
        };
      case 'world':
        return {
          icon: Globe,
          gradient: 'from-blue-500 to-cyan-500',
          emoji: '🌍',
        };
      default:
        return {
          icon: Sparkles,
          gradient: 'from-gray-600 to-gray-500',
          emoji: '✨',
        };
    }
  };

  const config = getCategoryConfig(category);
  const Icon = config.icon;

  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br ${config.gradient} ${className}`}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon className="w-24 h-24 text-white/20" strokeWidth={1} />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-6xl opacity-30">{config.emoji}</span>
      </div>
      {/* Noise overlay for texture */}
      <div className="absolute inset-0 bg-black/10"></div>
    </div>
  );
}
