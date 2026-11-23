import type { NextConfig } from 'next';

const backendOrigin = process.env.BACKEND_ORIGIN || 'http://127.0.0.1:3001';

const config: NextConfig = {
  agentRules: false,
  devIndicators: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: new URL('/api/:path*', backendOrigin).href }];
  },
};

export default config;
