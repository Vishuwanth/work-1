/** @type {import('next').NextConfig} */
const nextConfig = {
  // xlsx (SheetJS) uses a runtime `fs` require for XLSX.readFile; keep it external
  // so Next does not bundle/strip it in server components and server actions.
  experimental: {
    serverComponentsExternalPackages: ["xlsx"],
  },
};

export default nextConfig;
