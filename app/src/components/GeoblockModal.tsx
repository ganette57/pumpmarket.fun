'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const BLOCKED_COUNTRIES = [
  'United States', 'United Kingdom', 'France', 'Canada',
  'Singapore', 'Poland', 'Thailand', 'Taiwan',
  'Australia', 'Ukraine', 'Cuba', 'Iran',
  'Italy', 'North Korea', 'Russia', 'Belgium',
  'Belarus', 'Syria', 'Venezuela', 'Myanmar (Burma)'
];

// Country code mapping for IP detection
const BLOCKED_COUNTRY_CODES = [
  'US', 'GB', 'FR', 'CA', 'SG', 'PL', 'TH', 'TW',
  'AU', 'UA', 'CU', 'IR', 'IT', 'KP', 'RU', 'BE',
  'BY', 'SY', 'VE', 'MM'
];

interface GeoData {
  country_code?: string;
  country_name?: string;
}

export default function GeoblockModal() {
  const [isBlocked, setIsBlocked] = useState(false);
  const [country, setCountry] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if user already dismissed in this session
    const wasDismissed = sessionStorage.getItem('geoblock_dismissed');
    if (wasDismissed) {
      setDismissed(true);
      setLoading(false);
      return;
    }

    // Fetch user's location
    detectLocation();
  }, []);

  async function detectLocation() {
    try {
      // Using ipapi.co free tier (1000 requests/day)
      const response = await fetch('https://ipapi.co/json/', {
        signal: AbortSignal.timeout(5000), // 5s timeout
      });

      if (response.ok) {
        const data: GeoData = await response.json();
        const countryCode = data.country_code || '';
        const countryName = data.country_name || '';

        setCountry(countryName);

        if (BLOCKED_COUNTRY_CODES.includes(countryCode)) {
          setIsBlocked(true);
        }
      }
    } catch (error) {
      console.log('Location detection failed:', error);
      // Fail open - don't block if we can't detect
    } finally {
      setLoading(false);
    }
  }

  function handleDismiss() {
    sessionStorage.setItem('geoblock_dismissed', 'true');
    setDismissed(true);
  }

  if (loading || dismissed || !isBlocked) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm animate-fadeIn overflow-y-auto">
  <div className="min-h-[100dvh] flex items-center justify-center p-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(env(safe-area-inset-bottom)+96px)]">
  <div className="bg-pump-gray border-2 border-pump-red rounded-2xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl animate-slideUp max-h-[calc(100dvh-160px)] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-pump-red/20 rounded-full flex items-center justify-center">
              <span className="text-3xl">⚠️</span>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Access Restricted</h2>
              {country && (
                <p className="text-sm text-gray-400">Detected location: {country}</p>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="mb-8">
          <p className="text-gray-300 mb-6 text-lg">
            Funmarket.pump is not available in your region due to regulatory restrictions.
          </p>

          <div className="bg-pump-dark rounded-lg p-6 mb-6">
            <h3 className="text-white font-semibold mb-4 flex items-center">
              <span className="text-pump-red mr-2">🚫</span>
              This platform is restricted in:
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm text-gray-400">
              {BLOCKED_COUNTRIES.map((country) => (
                <div key={country} className="flex items-center space-x-2">
                  <span className="text-pump-red">•</span>
                  <span>{country}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <p className="text-yellow-200 text-sm">
              <strong className="font-semibold">⚠️ Important:</strong> Use of VPN or proxy services
              to bypass these restrictions is at your own risk. We do not encourage bypassing
              regional restrictions and are not responsible for any legal consequences.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={handleDismiss}
            className="flex-1 bg-pump-red hover:bg-red-600 text-white font-bold py-4 px-6 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
          >
            I Understand - Proceed at My Own Risk
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-4">
          By proceeding, you acknowledge that you are solely responsible for complying with your
          local laws and regulations.
        </p>
      </div>
      </div>

      <style jsx global>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }

        .animate-slideUp {
          animation: slideUp 0.4s ease-out;
        }
      `}</style>
    </div>
  );
}
