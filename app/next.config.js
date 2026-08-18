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

      // Rewards became Referrals.
      { source: "/rewards", destination: "/referrals", permanent: true },
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
  webpack: (config, { isServer }) => {
    // Privy v3 reaches its @solana/kit Solana support through
    // string-literal dynamic imports, which webpack tries to resolve and
    // bundle eagerly. Privy's v3 migration guide says to mark them
    // external (webpack only — Turbopack does not need it).
    //
    // SERVER BUILD ONLY. Privy's snippet is framework-agnostic; in Next
    // an external on the client bundle would emit a bare require() into
    // browser code and fail at runtime. On the server "commonjs <pkg>"
    // is exactly right, and these packages are real dependencies so Node
    // resolves them. Note also that Next's config.externals is an ARRAY,
    // so the mapping is PUSHED rather than assigned as properties — which
    // webpack would silently ignore on an array.
    if (isServer) {
      const solanaKitExternals = {
        "@solana/kit": "commonjs @solana/kit",
        "@solana-program/memo": "commonjs @solana-program/memo",
        "@solana-program/system": "commonjs @solana-program/system",
        "@solana-program/token": "commonjs @solana-program/token",
      };
      if (Array.isArray(config.externals)) {
        config.externals.push(solanaKitExternals);
      } else {
        config.externals = [config.externals, solanaKitExternals].filter(Boolean);
      }
    }

    // Privy declares several OPTIONAL peer dependencies for integrations
    // FunMarket does not use — Farcaster mini-apps, Abstract Global
    // Wallet, ERC-4337 bundlers. They are reached through conditional
    // dynamic imports, but webpack resolves those statically and fails
    // the build on the ones that are not installed. `false` is webpack's
    // documented way to say "this module is genuinely absent": it
    // resolves to an empty module instead of an error, and the code path
    // that would have used it never runs.
    //
    // Installing them instead would work too, and would add megabytes of
    // Ethereum tooling to a Solana-only app.
    for (const optionalPeer of [
      "@farcaster/mini-app-solana",
      "@abstract-foundation/agw-client",
      "permissionless",
    ]) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        [optionalPeer]: false,
      };
    }

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
