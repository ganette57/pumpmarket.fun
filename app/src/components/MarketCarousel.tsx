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
            <div className="flex-shrink-0 w-[500px] bg-pump-gray border border-gray-700 hover:border-pump-green rounded-xl transition-all duration-300 hover:shadow-2xl cursor-pointer group p-5">
              <div className="flex gap-4">
                {/* Image à gauche - carrée */}
                <div className="flex-shrink-0 w-32 h-32 rounded-xl overflow-hidden bg-pump-dark">
                  {market.image ? (
                    <Image
                      src={market.image}
                      alt={market.question}
                      width={128}
                      height={128}
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <div className="w-full h-full scale-[0.5]">
                      <CategoryImagePlaceholder category={market.category.toLowerCase()} className="w-full h-full" />
                    </div>
                  )}
                </div>

                {/* Contenu à droite */}
                <div className="flex-1 min-w-0 flex flex-col">
                  {/* Category badge + Title */}
                  <div className="mb-3">
                    <div className="inline-block px-2 py-1 bg-blue-500/20 border border-blue-500/30 rounded-full text-blue-400 text-xs font-semibold mb-2">
                      {market.category}
                    </div>
                    <h3 className="text-lg font-bold text-white group-hover:text-pump-green transition line-clamp-2 leading-tight">
                      {market.question}
                    </h3>
                  </div>

                  {/* Stats inline */}
                  <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      <span className="font-semibold text-white">
                        {(market.volume / 1_000_000_000).toFixed(0)}k SOL
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{market.daysLeft}d left</span>
                    </div>
                  </div>

                  {/* YES/NO inline */}
                  <div className="flex gap-3 mb-3">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 flex items-center gap-2">
                      <span className="text-xs text-blue-400">YES</span>
                      <span className="text-xl font-bold text-blue-400">{market.yesPercent}%</span>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-center gap-2">
                      <span className="text-xs text-red-400">NO</span>
                      <span className="text-xl font-bold text-red-400">{market.noPercent}%</span>
                    </div>
                  </div>

                  {/* Chart */}
                  <div className="h-16 flex-grow">
                    <Line data={getChartData(market.priceHistory)} options={chartOptions} />
                  </div>
                </div>
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
