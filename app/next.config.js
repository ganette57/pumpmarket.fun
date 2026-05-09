/** @type {import('next').NextConfig} */
const path = require("path");

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;
const r2Host = process.env.NEXT_PUBLIC_R2_IMAGE_HOST || undefined;

const nextConfig = {
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
