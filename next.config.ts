import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Multiple lockfiles exist because this worktree lives under the main
  // repo's .claude/worktrees/ directory; pin the workspace root explicitly
  // so Next.js doesn't infer it as the parent repo (which breaks pages/app
  // directory resolution for this worktree's `pages/` router).
  turbopack: {
    root: path.join(__dirname),
  },
  // next-auth's ESM build imports "next/server" without an extension, which
  // Node's strict ESM resolver can't resolve (next's package.json has no
  // "exports" map). That only surfaces when next-auth is treated as an
  // external module during Pages Router `getServerSideProps` page-data
  // collection; forcing it through Next's own bundler avoids the bare
  // Node resolution path.
  transpilePackages: ["next-auth"],
};

export default withNextIntl(nextConfig);
