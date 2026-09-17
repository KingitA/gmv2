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
  // unpdf: extracción de texto de PDF (importación de pedidos) — también runtime Node
  serverExternalPackages: ['@react-pdf/renderer', 'unpdf'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
}

export default nextConfig
