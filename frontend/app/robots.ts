import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Private and utility pages use noindex metadata. They remain crawlable so
    // search engines can see that directive; robots.txt is not an index-control tool.
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl(),
  };
}
