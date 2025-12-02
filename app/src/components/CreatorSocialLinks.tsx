'use client';

import { Globe, Twitter, MessageCircle, MessageSquare, Link, ExternalLink } from 'lucide-react';
import { SocialLinks } from './SocialLinksForm';

interface CreatorSocialLinksProps {
  socialLinks?: SocialLinks;
  className?: string;
}

export default function CreatorSocialLinks({ socialLinks, className = '' }: CreatorSocialLinksProps) {
  if (!socialLinks) return null;

  const links = [
    {
      key: 'website',
      url: socialLinks.website,
      icon: Globe,
      label: 'Website',
      color: 'hover:bg-blue-500/20 hover:border-blue-400',
      iconColor: 'text-blue-400',
    },
    {
      key: 'twitter',
      url: socialLinks.twitter,
      icon: Twitter,
      label: 'X',
      color: 'hover:bg-sky-500/20 hover:border-sky-400',
      iconColor: 'text-sky-400',
    },
    {
      key: 'telegram',
      url: socialLinks.telegram,
      icon: MessageCircle,
      label: 'Telegram',
      color: 'hover:bg-blue-500/20 hover:border-blue-500',
      iconColor: 'text-blue-500',
    },
    {
      key: 'discord',
      url: socialLinks.discord,
      icon: MessageSquare,
      label: 'Discord',
      color: 'hover:bg-indigo-500/20 hover:border-indigo-400',
      iconColor: 'text-indigo-400',
    },
    {
      key: 'other',
      url: socialLinks.other,
      icon: Link,
      label: 'Link',
      color: 'hover:bg-gray-500/20 hover:border-gray-400',
      iconColor: 'text-gray-400',
    },
  ].filter((link) => link.url); // Only show links that have URLs

  if (links.length === 0) return null;

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <span className="text-xs text-gray-500 font-medium mr-1">Creator:</span>
      {links.map((link) => {
        const Icon = link.icon;
        return (
          <a
            key={link.key}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`
              group relative
              flex items-center justify-center
              w-9 h-9 rounded-full
              bg-pump-gray border border-gray-700
              transition-all duration-200
              ${link.color}
              hover:scale-110 hover:shadow-lg
            `}
            title={link.label}
          >
            <Icon className={`w-4 h-4 ${link.iconColor} transition-transform group-hover:scale-110`} />

            {/* Tooltip */}
            <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 px-2 py-1 bg-pump-dark border border-gray-700 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              {link.label}
            </span>

            {/* External link indicator on hover */}
            <ExternalLink className="absolute -top-1 -right-1 w-3 h-3 text-pump-green opacity-0 group-hover:opacity-100 transition-opacity" />
          </a>
        );
      })}
    </div>
  );
}
