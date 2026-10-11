const apiPort = process.env.API_PORT || "3002";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Vercel serves the existing API function directly. Local Node deployments
    // run the API process beside Next.js and route same-origin API calls to it.
    if (process.env.VERCEL) return [];
    return [
      {
        source: "/api/:path*",
        destination: `http://127.0.0.1:${apiPort}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
