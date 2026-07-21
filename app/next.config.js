/** @type {import('next').NextConfig} */
const path = require("path");

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;
const r2Host = process.env.NEXT_PUBLIC_R2_IMAGE_HOST || undefined;

const nextConfig = {
  async redirects() {
    return [
      // The World Cup campaign is over and its public hub is gone. Send the
      // old entry points somewhere useful rather than 404-ing inbound links.
      { source: "/world-cup/leaderboard", destination: "/leaderboard", permanent: true },
      { source: "/world-cup/treasury", destination: "/treasury", permanent: true },
      // The match / side-market browsers were market lists — the feed is the
      // generic replacement.
      { source: "/world-cup/matches", destination: "/", permanent: true },
      { source: "/world-cup/side-markets", destination: "/", permanent: true },
      // Hub root + any remaining child route.
      { source: "/world-cup", destination: "/leaderboard", permanent: true },
      { source: "/world-cup/:path*", destination: "/leaderboard", permanent: true },
    ];
  },
  images: {
    unoptimized: true,
    domains: [supabaseHost, r2Host].filter(Boolean),
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/**",
      },
      ...(r2Host
        ? [
            {
              protocol: "https",
              hostname: r2Host,
              pathname: "/**",
            },
          ]
        : []),
    ],
  },
  webpack: (config) => {
    // Force a single instance of @solana/wallet-adapter-react so that
    // WalletProvider and useWallet share the same React Context. Without this,
    // a stray app/node_modules/node_modules symlink can cause webpack to
    // resolve the package twice (once via the worktree, once via the main
    // repo), producing duplicate WalletContexts and an empty wallet modal.
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@solana/wallet-adapter-react": path.resolve(
        __dirname,
        "node_modules/@solana/wallet-adapter-react",
      ),
    };
    return config;
  },
};

module.exports = nextConfig;
