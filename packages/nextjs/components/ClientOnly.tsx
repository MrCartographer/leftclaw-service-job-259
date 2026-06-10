"use client";

import { useEffect, useState } from "react";

/**
 * Renders children only after the component has mounted on the client.
 * Useful for static-export builds where wagmi/RainbowKit providers are
 * gated behind a `mounted` check and child pages would otherwise call
 * wagmi hooks (e.g. `useConfig`, `usePublicClient`) without a provider
 * during the SSG prerender pass.
 */
export const ClientOnly = ({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <>{fallback}</>;
  return <>{children}</>;
};
