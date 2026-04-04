import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'async_hooks': 'node:async_hooks',
      };
      config.externals = [...(config.externals || []), 'node:async_hooks'];
    }
    return config;
  },
};

export default nextConfig;
