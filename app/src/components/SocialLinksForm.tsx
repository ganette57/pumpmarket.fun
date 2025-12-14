'use client';

import { useState } from 'react';
import { Globe, Twitter, MessageCircle, MessageSquare, Link } from 'lucide-react';

export interface SocialLinks {
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  other?: string;
}

interface SocialLinksFormProps {
  value: SocialLinks;
  onChange: (links: SocialLinks) => void;
}

export default function SocialLinksForm({ value, onChange }: SocialLinksFormProps) {
  const [errors, setErrors] = useState<Partial<SocialLinks>>({});

  const validateUrl = (url: string): boolean => {
    if (!url) return true; // Empty is valid (optional)
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleChange = (field: keyof SocialLinks, inputValue: string) => {
    const trimmed = inputValue.trim();

    // Update value
    onChange({
      ...value,
      [field]: trimmed || undefined,
    });

    // Validate
    if (trimmed && !validateUrl(trimmed)) {
      setErrors((prev) => ({
        ...prev,
        [field]: 'Invalid URL format',
      }));
    } else {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const socialFields = [
    {
      key: 'website' as keyof SocialLinks,
      label: 'Website',
      icon: Globe,
      placeholder: 'https://yoursite.com',
      color: 'text-blue-400',
    },
    {
      key: 'twitter' as keyof SocialLinks,
      label: 'X (Twitter)',
      icon: Twitter,
      placeholder: 'https://x.com/username',
      color: 'text-sky-400',
    },
    {
      key: 'telegram' as keyof SocialLinks,
      label: 'Telegram',
      icon: MessageCircle,
      placeholder: 'https://t.me/username',
      color: 'text-blue-500',
    },
    {
      key: 'discord' as keyof SocialLinks,
      label: 'Discord',
      icon: MessageSquare,
      placeholder: 'https://discord.gg/invite',
      color: 'text-indigo-400',
    },
    {
      key: 'other' as keyof SocialLinks,
      label: 'Other',
      icon: Link,
      placeholder: 'https://other-link.com',
      color: 'text-gray-400',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Social Links (Optional)</h3>
        <span className="text-xs text-gray-500">Share your socials with traders</span>
      </div>

      {socialFields.map((field) => {
        const Icon = field.icon;
        return (
          <div key={field.key}>
            <label className="block text-gray-300 text-sm font-medium mb-2">
              <span className="flex items-center space-x-2">
                <Icon className={`w-4 h-4 ${field.color}`} />
                <span>{field.label}</span>
              </span>
            </label>
            <input
              type="url"
              value={value[field.key] || ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className={`input-pump w-full ${
                errors[field.key] ? 'border-pump-red' : ''
              }`}
            />
            {errors[field.key] && (
              <p className="text-pump-red text-xs mt-1">⚠️ {errors[field.key]}</p>
            )}
          </div>
        );
      })}

      <div className="mt-4 p-3 bg-pump-dark rounded-lg">
        <p className="text-xs text-gray-500">
          💡 <strong className="text-gray-400">Tip:</strong> Adding social links helps build trust
          with traders and lets them follow updates about your market.
        </p>
      </div>
    </div>
  );
}
