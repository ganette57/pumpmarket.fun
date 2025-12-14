'use client';
import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface BondingCurveChartProps {
  currentSupply: number;
  isYes: boolean;
}

export default function BondingCurveChart({ currentSupply, isYes }: BondingCurveChartProps) {
  const chartRef = useRef<HTMLCanvasElement>(null);

  // Fonction directement ici pour éviter les problèmes d'import
  const calculateBondingCurvePrice = (supply: number): number => {
    const basePrice = 0.01;
    const pricePerUnit = basePrice + (supply / 100000);
    return pricePerUnit;
  };

  useEffect(() => {
    if (!chartRef.current) return;

    const ctx = chartRef.current.getContext('2d');
    if (!ctx) return;

    // Generate data points for the bonding curve
    const dataPoints = [];
    const maxSupply = Math.max(currentSupply * 2, 1000);
    for (let i = 0; i <= maxSupply; i += maxSupply / 50) {
      const price = calculateBondingCurvePrice(i);
      dataPoints.push({ x: i, y: price });
    }

    // Create chart
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Price (SOL)',
          data: dataPoints,
          borderColor: isYes ? '#3b82f6' : '#ef4444',
          backgroundColor: isYes ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: 'Supply',
              color: '#9ca3af'
            },
            grid: {
              color: 'rgba(75, 85, 99, 0.2)'
            },
            ticks: {
              color: '#9ca3af'
            }
          },
          y: {
            type: 'linear',
            title: {
              display: true,
              text: 'Price (SOL)',
              color: '#9ca3af'
            },
            grid: {
              color: 'rgba(75, 85, 99, 0.2)'
            },
            ticks: {
              color: '#9ca3af',
              callback: function(value) {
                return value.toFixed(4);
              }
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(17, 24, 39, 0.9)',
            titleColor: '#f9fafb',
            bodyColor: '#f9fafb',
            borderColor: '#374151',
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                return `Price: ${context.parsed.y.toFixed(6)} SOL`;
              }
            }
          }
        }
      }
    });

    return () => {
      chart.destroy();
    };
  }, [currentSupply, isYes]);

  return (
    <div className="w-full h-full">
      <canvas ref={chartRef}></canvas>
    </div>
  );
}
