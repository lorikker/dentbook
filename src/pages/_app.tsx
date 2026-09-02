import type { AppProps } from "next/app";
import "@/app/globals.css";

// Pages Router root. Kept intentionally minimal: the App Router's Header
// is an async Server Component and cannot be rendered from here, so each
// Pages Router page under `pages/` renders its own lightweight nav instead.
export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
