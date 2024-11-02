import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useState } from "react";
import { SessionContextProvider } from "@supabase/auth-helpers-react";
import { createBrowserClient } from "@supabase/ssr";

export default function App({ Component, pageProps }: AppProps) {
  const [supabase] = useState(() =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    )
  );

  return (
    <SessionContextProvider supabaseClient={supabase}>
      <Component {...pageProps} />
    </SessionContextProvider>
  );
}
