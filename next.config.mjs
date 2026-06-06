/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: false,
  typescript: {
    // TODO: Fase 0 - Activar validación de tipos una vez corregidos los errores
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // @react-pdf/renderer necesita correr en el runtime de Node.js, no en el bundle del browser
  serverExternalPackages: ['@react-pdf/renderer'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
}

export default nextConfig
