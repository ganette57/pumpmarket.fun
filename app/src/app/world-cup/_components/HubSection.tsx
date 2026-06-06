// app/src/app/world-cup/_components/HubSection.tsx
"use client";

import { ReactNode } from "react";

interface HubSectionProps {
  title: string;
  subtitle?: string;
  /** Optional element rendered on the right of the header (e.g. a "View all" link). */
  action?: ReactNode;
  /** When true, applies a thin gold accent to the title (championship-coded sections). */
  goldTitle?: boolean;
  children: ReactNode;
  /** When true, removes the default vertical padding (caller controls spacing). */
  flush?: boolean;
}

/**
 * Section wrapper used across the World Cup hub.
 * Keeps the FunMarket spacing system: max-w-7xl, px-4 sm:px-6 lg:px-8, py-8.
 */
export default function HubSection({
  title,
  subtitle,
  action,
  goldTitle = false,
  children,
  flush = false,
}: HubSectionProps) {
  return (
    <section className={flush ? "" : "py-8"}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h2
              className="text-xl md:text-2xl font-bold tracking-tight"
              style={goldTitle ? { color: "#EAB54C" } : { color: "#ffffff" }}
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {children}
      </div>
    </section>
  );
}
