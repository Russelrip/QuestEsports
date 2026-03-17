import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Quest Esports LK",
    short_name: "Quest Esports",
    description:
      "Sri Lankan esports tournaments, livestreams, posters, and competitive gaming events from Quest Esports.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#070b16",
    theme_color: "#0b1020",
    categories: ["sports", "entertainment", "games"],
    icons: [
      {
        src: absoluteUrl("/images/logo-header.png"),
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: absoluteUrl("/images/logo-header.png"),
        sizes: "192x192",
        type: "image/png",
      },
    ],
  };
}
