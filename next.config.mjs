/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Type errors fail the build. They were ignored while prisma.config.ts (a
  // Prisma 6 file this Prisma 5 project never read) broke the check.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'source.unsplash.com',
      },
    ],
  },
  serverExternalPackages: ["@libsql/client", "libsql"],
}

export default nextConfig
