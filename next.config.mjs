/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    '@napi-rs/canvas',
    'pdfjs-dist',
    '@sparticuz/chromium',
    'puppeteer-core',
    'typeorm',
  ],
  outputFileTracingIncludes: {
    '/**/*': [
      './node_modules/@napi-rs/canvas/**',
      './node_modules/@sparticuz/chromium/**',
    ],
    // app/admin/docs/page.tsx reads these with a runtime-constructed
    // fs.readFileSync(path.join(process.cwd(), filename)) path, not a
    // static import — @vercel/nft's tracing only reliably follows
    // import/require, so a dynamic fs read like this can silently miss
    // the deployment bundle without an explicit include here. Scoped to
    // just the docs route rather than '/**/*' since nothing else needs
    // these three files.
    '/admin/docs': [
      './ADMIN_GUIDE.md',
      './WIKI.md',
      './INTEGRATIONS.md',
    ],
  },
  // typeorm (pulled in via @boxyhq/saml-jackson, used for SAML SSO)
  // conditionally supports several drivers (React Native SQLite, MySQL,
  // SAP HANA) that are never actually used server-side — webpack still
  // tries to resolve them and fails the build. Telling it to treat these
  // imports as unavailable rather than hard errors.
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      'react-native-sqlite-storage': false,
      'mysql': false,
      '@sap/hana-client/extension/Stream': false,
    };
    return config;
  },
};
export default nextConfig;
