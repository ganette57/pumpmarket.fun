'use client';

import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { calculateBondingCurvePrice } from '@/utils/solana';

Chart.register(...registerables);

interface BondingCurveChartProps {
  currentSupply: number;
  isYes: boolean;
}

export default function BondingCurveChart({ currentSupply, isYes }: BondingCurveChartProps) {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    // Destroy existing chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const ctx = chartRef.current.getContext('2d');
    if (!ctx) return;

    // Generate data points for bonding curve
    const dataPoints = [];
    const maxSupply = Math.max(currentSupply * 2, 1000);
    for (let i = 0; i <= maxSupply; i += maxSupply / 50) {
      const price = calculateBondingCurvePrice(i);
      dataPoints.push({ x: i, y: price });
    }

    chartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Price per Share',
            data: dataPoints,
            borderColor: isYes ? '#3b82f6' : '#ef4444',
            backgroundColor: isYes ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
          },
          {
            label: 'Current Supply',
            data: [
              { x: currentSupply, y: 0 },
              { x: currentSupply, y: calculateBondingCurvePrice(currentSupply) },
            ],
            borderColor: '#00ff88',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 5,
            pointBackgroundColor: '#00ff88',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: '#1a1a1a',
            titleColor: '#fff',
            bodyColor: '#00ff88',
            borderColor: '#00ff88',
            borderWidth: 1,
            callbacks: {
              label: (context) => {
                return `${(context.parsed.y ?? 0).toFixed(4)} SOL`;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: 'Supply',
              color: '#9ca3af',
            },
            grid: {
              color: '#2a2a2a',
            },
            ticks: {
              color: '#9ca3af',
            },
          },
          y: {
            title: {
              display: true,
              text: 'Price (SOL)',
              color: '#9ca3af',
            },
            grid: {
              color: '#2a2a2a',
            },
            ticks: {
              color: '#9ca3af',
              callback: (value) => `${(value as number).toFixed(4)}`,
            },
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [currentSupply, isYes]);

  return (
    <div className="w-full h-64 bg-pump-dark rounded-lg p-4">
      <canvas ref={chartRef}></canvas>
    </div>
  );
}