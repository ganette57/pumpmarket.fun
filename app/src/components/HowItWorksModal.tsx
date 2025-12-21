'use client';

import { useState } from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import Link from 'next/link';

interface Step {
  icon: string;
  title: string;
  description: string;
  color: string;
}

const STEPS: Step[] = [
  {
    icon: '🎯',
    title: 'Pick a Market',
    description:
      'Browse trending predictions or create your own. Buy "Yes" or "No" shares on any outcome.',
    color: 'from-blue-500 to-purple-500',
  },
  {
    icon: '📈',
    title: 'Trade Live',
    description:
      'Prices update instantly when traders buy or sell shares. Odds change based on demand — if people pile into an outcome, its price rises. Simple, dynamic, transparent.',
    color: 'from-green-500 to-teal-500',
  },
  {
    icon: '🏆',
    title: 'Resolve & Win',
    description:
      'When the market resolves, winners claim the pool. Simple, transparent, on-chain.',
    color: 'from-orange-500 to-red-500',
  },
  {
    icon: '💰',
    title: 'Earn Fees',
    description:
      'Market creators earn 1% on every trade. Platform earns 1%. Everyone wins.',
    color: 'from-pump-green to-green-400',
  },
];

interface HowItWorksModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HowItWorksModal({
  isOpen,
  onClose,
}: HowItWorksModalProps) {
  const [currentStep, setCurrentStep] = useState(0);

  if (!isOpen) return null;

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const step = STEPS[currentStep];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-pump-gray border border-pump-green/30 rounded-2xl max-w-3xl w-full mx-4 overflow-hidden shadow-2xl animate-slideUp">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-pump-green/20 to-blue-500/20 p-6 border-b border-gray-700">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-white transition"
          >
            <X className="w-6 h-6" />
          </button>
          <h2 className="text-3xl font-bold text-white mb-2">
            🚀 How Funmarket.pump Works
          </h2>
          <p className="text-gray-300">
            Prediction markets made simple, fun, and profitable
          </p>
        </div>

        {/* Content */}
        <div className="p-8">
          {/* Steps indicator */}
          <div className="flex justify-center mb-8">
            {STEPS.map((_, index) => (
              <div
                key={index}
                className={`w-12 h-2 mx-1 rounded-full transition-all duration-300 ${
                  index === currentStep
                    ? 'bg-pump-green w-16'
                    : index < currentStep
                    ? 'bg-pump-green/50'
                    : 'bg-gray-700'
                }`}
              />
            ))}
          </div>

          {/* Step content */}
          <div className="min-h-[280px] flex flex-col items-center text-center">
            <div
              className={`w-24 h-24 rounded-full bg-gradient-to-br ${step.color} flex items-center justify-center mb-6 shadow-lg animate-bounce-slow`}
            >
              <span className="text-5xl">{step.icon}</span>
            </div>

            <h3 className="text-2xl font-bold text-white mb-4">{step.title}</h3>

            <p className="text-lg text-gray-300 max-w-xl leading-relaxed">
              {step.description}
            </p>

            {currentStep === 3 && (
              <div className="mt-6 grid grid-cols-2 gap-4 w-full max-w-md">
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-400">2%</div>
                  <div className="text-sm text-gray-400">Creator Fee</div>
                </div>
                <div className="bg-pump-green/10 border border-pump-green/30 rounded-lg p-4">
                  <div className="text-2xl font-bold text-pump-green">1%</div>
                  <div className="text-sm text-gray-400">Platform Fee</div>
                </div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-700">
            <button
              onClick={handlePrev}
              disabled={currentStep === 0}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-semibold transition ${
                currentStep === 0
                  ? 'text-gray-600 cursor-not-allowed'
                  : 'text-white hover:bg-pump-dark'
              }`}
            >
              <ChevronLeft className="w-5 h-5" />
              <span>Previous</span>
            </button>

            <div className="text-sm text-gray-400">
              Step {currentStep + 1} of {STEPS.length}
            </div>

            {currentStep < STEPS.length - 1 ? (
              <button
                onClick={handleNext}
                className="flex items-center space-x-2 px-4 py-2 bg-pump-green hover:bg-green-400 text-black font-bold rounded-lg transition"
              >
                <span>Next</span>
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <Link href="/create">
                <button
                  onClick={onClose}
                  className="px-6 py-2 bg-pump-green hover:bg-green-400 text-black font-bold rounded-lg transition glow-green"
                >
                  Create Your First Market →
                </button>
              </Link>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes bounce-slow {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }

        .animate-bounce-slow {
          animation: bounce-slow 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}