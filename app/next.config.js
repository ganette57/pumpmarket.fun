/** @type {import('next').NextConfig} */
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;
const r2Host = process.env.NEXT_PUBLIC_R2_IMAGE_HOST || undefined;

const nextConfig = {
  images: {
    domains: [supabaseHost, r2Host].filter(Boolean),
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
    ],
  },
};

module.exports = nextConfig;
