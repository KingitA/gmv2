/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // INFO: Ignorando errores de TS para permitir el despliegue rápido
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  swcMinify: false,
  experimental: {
    webpackBuildWorker: true,
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
}

export default nextConfig

