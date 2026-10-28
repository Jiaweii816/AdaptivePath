import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/adaptivepath/textbook/*": ["./src/features/adaptivepath/data/biology-12-2/assets/pages/*.png"],
    "/*": ["./node_modules/sqlite-vec/**/*", "./node_modules/sqlite-vec-linux-x64/**/*"],
  },
  // sqlite-vec resolves and loads a platform-native .so at runtime. Keeping
  // the package external prevents Turbopack from trying to compile that
  // binary as a JavaScript module.
  serverExternalPackages: ["sqlite-vec"],
  // Keeps manual Windows/WSL browser visits to 127.0.0.1 from triggering
  // Next 16 dev-resource origin warnings. Add "::1" here too if a future
  // Playwright or browser run moves back to IPv6 loopback.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
