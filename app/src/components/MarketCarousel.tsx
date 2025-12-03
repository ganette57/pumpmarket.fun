'use client';

import { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, TrendingUp, Clock } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import CategoryImagePlaceholder from './CategoryImagePlaceholder';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

interface FeaturedMarket {
  id: string;
  question: string;
  category: string;
  yesPercent: number;
  noPercent: number;
  volume: number;
  daysLeft: number;
  priceHistory: number[];
  image?: string;
}

const FEATURED_MARKETS: FeaturedMarket[] = [
  {
    id: '1',
    question: 'Will SOL reach $500 before end of 2025?',
    category: 'Crypto',
    yesPercent: 62,
    noPercent: 38,
    volume: 156_000_000_000,
    daysLeft: 45,
    priceHistory: [0.45, 0.48, 0.52, 0.58, 0.62, 0.60, 0.62],
  },
  {
    id: '2',
    question: 'Will Bitcoin hit $100k this quarter?',
    category: 'Crypto',
    yesPercent: 71,
    noPercent: 29,
    volume: 289_000_000_000,
    daysLeft: 28,
    priceHistory: [0.55, 0.60, 0.65, 0.68, 0.70, 0.69, 0.71],
  },
  {
    id: '3',
    question: 'Will Ethereum merge be delayed again?',
    category: 'Tech',
    yesPercent: 34,
    noPercent: 66,
    volume: 95_000_000_000,
    daysLeft: 67,
    priceHistory: [0.45, 0.42, 0.38, 0.35, 0.34, 0.33, 0.34],
  },
  {
    id: '4',
    question: 'Will Trump win 2024 US election?',
    category: 'Politics',
    yesPercent: 48,
    noPercent: 52,
    volume: 425_000_000_000,
    daysLeft: 120,
    priceHistory: [0.50, 0.49, 0.47, 0.48, 0.49, 0.48, 0.48],
  },
];

export default function MarketCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  function handleScroll(direction: 'left' | 'right') {
    if (!scrollRef.current) return;

    const scrollAmount = 400;
    const newScroll =
      direction === 'left'
        ? scrollRef.current.scrollLeft - scrollAmount
        : scrollRef.current.scrollLeft + scrollAmount;

    scrollRef.current.scrollTo({ left: newScroll, behavior: 'smooth' });
  }

  function getChartData(priceHistory: number[]) {
    return {
      labels: priceHistory.map((_, i) => `Day ${i + 1}`),
      datasets: [
        {
          data: priceHistory,
          borderColor: '#00ff88',
          backgroundColor: 'rgba(0, 255, 136, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
        },
      ],
    };
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        backgroundColor: '#1a1a1a',
        titleColor: '#fff',
        bodyColor: '#00ff88',
        borderColor: '#00ff88',
        borderWidth: 1,
        displayColors: false,
        callbacks: {
          label: (context: any) => `${(context.parsed.y * 100).toFixed(1)}%`,
        },
      },
    },
    scales: {
      x: { display: false },
      y: {
        display: false,
        min: 0,
        max: 1,
      },
    },
    interaction: {
      intersect: false,
      mode: 'index' as const,
    },
  };

  return (
    <div className="relative">
      {/* Navigation Buttons */}
      <div className="absolute right-0 -top-10 flex space-x-2 z-10">
        <button
          onClick={() => handleScroll('left')}
          className="p-2 bg-pump-gray hover:bg-pump-dark border border-gray-700 rounded-lg transition"
        >
          <ChevronLeft className="w-5 h-5 text-white" />
        </button>
        <button
          onClick={() => handleScroll('right')}
          className="p-2 bg-pump-gray hover:bg-pump-dark border border-gray-700 rounded-lg transition"
        >
          <ChevronRight className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Carousel */}
      <div
        ref={scrollRef}
        className="flex space-x-6 overflow-x-auto scrollbar-hide scroll-smooth pb-4"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {FEATURED_MARKETS.map((market) => (
          <Link key={market.id} href={`/trade/${market.id}`}>
            <div className="flex-shrink-0 w-[500px] bg-pump-gray border border-gray-700 hover:border-pump-green rounded-xl overflow-hidden transition-all duration-300 hover:shadow-2xl cursor-pointer group">
              {/* Market Image */}
              <div className="relative w-full h-48 overflow-hidden bg-pump-dark">
                {market.image ? (
                  <Image
                    src={market.image}
                    alt={market.question}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <CategoryImagePlaceholder category={market.category.toLowerCase()} className="w-full h-full" />
                )}
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-pump-dark/90 to-transparent"></div>
              </div>

              {/* Top Section */}
              <div className="p-6 pb-4">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="inline-block px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded-full text-blue-400 text-xs font-semibold mb-3">
                      {market.category}
                    </div>
                    <h3 className="text-lg font-bold text-white group-hover:text-pump-green transition line-clamp-2">
                      {market.question}
                    </h3>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center justify-between text-sm mb-4">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center text-gray-400">
                      <TrendingUp className="w-4 h-4 mr-1" />
                      <span className="font-semibold text-white">
                        {(market.volume / 1_000_000_000).toFixed(0)}k SOL
                      </span>
                    </div>
                    <div className="flex items-center text-gray-400">
                      <Clock className="w-4 h-4 mr-1" />
                      <span>Ends in {market.daysLeft}d</span>
                    </div>
                  </div>
                </div>

                {/* Percentages */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                    <div className="text-xs text-blue-400 mb-1">YES</div>
                    <div className="text-3xl font-bold text-blue-400">{market.yesPercent}%</div>
                  </div>
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <div className="text-xs text-red-400 mb-1">NO</div>
                    <div className="text-3xl font-bold text-red-400">{market.noPercent}%</div>
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="h-24 px-6 pb-4">
                <Line data={getChartData(market.priceHistory)} options={chartOptions} />
              </div>
            </div>
          </Link>
        ))}
      </div>

      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
