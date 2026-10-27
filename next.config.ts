import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel 自带优化打包，无需 standalone；自托管/本地生产模式使用 standalone
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
