import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/tournaments", "/match-videos", "/posters", "/rulebook", "/contact"],
        disallow: ["/admin", "/login", "/signup", "/profile"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl(),
  };
}
