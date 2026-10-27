import type { NextConfig } from "next";

// DEPLOY_TARGET=pages → GitHub Pages 纯静态导出（output: export + basePath + 关闭图片优化）
// 默认（未设 DEPLOY_TARGET）保持本地 dev / Vercel / standalone 自托管行为完全不变
const isPages = process.env.DEPLOY_TARGET === "pages";

// 非 Pages 环境的输出模式：Vercel 自带优化打包无需 standalone；本地/自托管生产模式用 standalone
const nonPagesOutput = process.env.VERCEL
  ? {}
  : { output: "standalone" as const };

const nextConfig: NextConfig = {
  ...(isPages
    ? {
        output: "export" as const,
        basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
        images: { unoptimized: true },
      }
    : nonPagesOutput),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
