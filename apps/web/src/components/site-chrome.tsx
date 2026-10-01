"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const PRODUCT_PREFIXES = ["/app", "/scan", "/clinician", "/shared", "/signin"];

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const productRoute = PRODUCT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (productRoute) return <>{children}</>;
  return (
    <>
      <SiteHeader />
      <main id="main-content">{children}</main>
      <SiteFooter />
    </>
  );
}
