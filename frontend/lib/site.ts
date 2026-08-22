import type { Metadata } from "next";
import type { Product } from "@/lib/shop";
import type { TicketedEvent } from "@/lib/tickets";
import type { Tournament } from "@/lib/tournaments";
import type { NavIconKey } from "@/lib/icons";

const siteName = "Quest E-sports LK";
const siteTitle = "Quest E-sports LK";
const siteDescription =
  "Join Quest E-sports LK for Sri Lankan esports tournaments, team registration, live match broadcasts, brackets, highlights, and community events.";
const fallbackSiteUrl =
  process.env.NODE_ENV === "production"
    ? "https://questesports.lk"
    : "http://localhost:3000";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || fallbackSiteUrl;
const creatorHandle = "@questesportslk";
const defaultLocale = "en_US";
// Keep a version in the URL so social platforms fetch a fresh preview when the
// artwork changes instead of continuing to serve a cached image.
const defaultSocialImage = "/images/mainbg.png?v=20260718";

const defaultKeywords = [
  "Quest E-sports",
  "Quest E-sports LK",
  "Sri Lanka e-sports",
  "Sri Lankan gaming tournaments",
  "e-sports tournaments",
  "VALORANT tournament",
  "gaming community Sri Lanka",
  "competitive gaming",
  "match livestreams",
  "e-sports event gallery",
];

const channelKeywords = {
  youtube: [
    "YouTube gaming",
    "e-sports highlights",
    "match replays",
    "live stream tournament",
  ],
  instagram: [
    "Instagram gaming content",
    "e-sports reels",
    "gaming highlights",
    "community updates",
  ],
  tiktok: [
    "TikTok gaming",
    "short-form e-sports clips",
    "gaming edits",
    "viral e-sports moments",
  ],
  linkedin: [
    "e-sports brand",
    "gaming events",
    "community partnerships",
    "creator collaborations",
  ],
  appStores: [
    "mobile e-sports",
    "tournament registration",
    "gaming event updates",
    "player community",
  ],
} as const;

const defaultOpenGraphImage = {
  url: defaultSocialImage,
  width: 1920,
  height: 1080,
  alt: `${siteTitle} social share banner`,
};

export const siteMetadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${siteTitle} | Sri Lanka E-sports Tournaments & Match Highlights`,
    template: `%s | ${siteTitle}`,
  },
  description: siteDescription,
  applicationName: siteName,
  keywords: [
    ...defaultKeywords,
    ...channelKeywords.youtube,
    ...channelKeywords.instagram,
    ...channelKeywords.tiktok,
    ...channelKeywords.linkedin,
    ...channelKeywords.appStores,
  ],
  alternates: {
    canonical: "/",
  },
  category: "gaming",
  classification: "E-sports and gaming community",
  openGraph: {
    type: "website",
    locale: defaultLocale,
    url: siteUrl,
    title: `${siteTitle} | Sri Lanka E-sports Tournaments & Match Highlights`,
    description: siteDescription,
    siteName: siteName,
    images: [defaultOpenGraphImage],
  },
  twitter: {
    card: "summary_large_image",
    creator: creatorHandle,
    title: `${siteTitle} | Sri Lanka E-sports Tournaments & Match Highlights`,
    description: siteDescription,
    images: [defaultSocialImage],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon", sizes: "16x16 32x32 48x48" },
      { url: "/favicon-48.png", type: "image/png", sizes: "48x48" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: "/favicon.ico",
    apple: {
      url: "/apple-touch-icon.png",
      type: "image/png",
      sizes: "180x180",
    },
  },
  manifest: "/manifest.webmanifest",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
  },
};

type PageMetadataOptions = {
  title: string;
  absoluteTitle?: string;
  description: string;
  path: string;
  keywords?: string[];
  image?: string;
  type?: "website" | "article";
  noIndex?: boolean;
};

const mergeKeywords = (...keywords: Array<readonly string[] | undefined>) =>
  Array.from(
    new Set([...defaultKeywords, ...keywords.flatMap((entry) => entry ?? [])]),
  );

const resolvePath = (path: string) =>
  path.startsWith("/") ? path : `/${path}`;

export const absoluteUrl = (path = "/") =>
  new URL(
    /^https?:\/\//i.test(path) ? path : resolvePath(path),
    siteUrl,
  ).toString();

export const buildPageMetadata = ({
  title,
  absoluteTitle,
  description,
  path,
  keywords,
  image = defaultSocialImage,
  type = "website",
  noIndex = false,
}: PageMetadataOptions): Metadata => {
  const canonicalPath = resolvePath(path);
  const pageTitle = absoluteTitle || `${title} | ${siteTitle}`;

  return {
    title: absoluteTitle ? { absolute: absoluteTitle } : title,
    description,
    keywords: mergeKeywords(
      keywords,
      channelKeywords.youtube,
      channelKeywords.instagram,
      channelKeywords.tiktok,
      channelKeywords.linkedin,
      channelKeywords.appStores,
    ),
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      type,
      url: canonicalPath,
      title: pageTitle,
      description,
      siteName,
      locale: defaultLocale,
      images: [
        {
          ...defaultOpenGraphImage,
          url: image,
          alt: `${title} preview for ${siteTitle}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      creator: creatorHandle,
      title: pageTitle,
      description,
      images: [image],
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
          googleBot: {
            index: false,
            follow: false,
            noimageindex: true,
          },
        }
      : undefined,
  };
};

export const buildTournamentMetadata = (tournament: Tournament): Metadata => {
  const description =
    tournament.shortDescription ||
    tournament.fullDescription ||
    "View tournament status, rules, schedule, and registration details.";

  const keywords = [
    tournament.title,
    tournament.game,
    `${tournament.game} tournament`,
    `${tournament.game} e-sports`,
    "e-sports event",
    "team registration",
    tournament.status.replace(/_/g, " "),
    tournament.format,
  ];

  return buildPageMetadata({
    title: tournament.title,
    description,
    path: `/tournaments/${tournament.slug}`,
    keywords,
    image: tournament.bannerUrl || defaultSocialImage,
    type: "article",
  });
};

export const buildNoIndexMetadata = (
  title: string,
  description: string,
  path: string,
): Metadata =>
  buildPageMetadata({
    title,
    description,
    path,
    noIndex: true,
  });

export const organizationStructuredData = {
  "@context": "https://schema.org",
  "@type": "SportsOrganization",
  name: siteTitle,
  alternateName: ["Quest Esports LK", "Quest Esports", "questesports.lk"],
  url: siteUrl,
  logo: absoluteUrl("/icon-512.png"),
  image: absoluteUrl(defaultSocialImage),
  description: siteDescription,
  email: "questesports.lk@gmail.com",
  sameAs: [
    "https://discord.gg/cxkM7dk9CM",
    "https://www.facebook.com/share/1HNNM3e9ub/?mibextid=wwXIfr",
    "https://www.instagram.com/questesports.lk",
    "https://www.tiktok.com/@senumii",
    "https://www.tiktok.com/@questesports.lk",
  ],
  areaServed: "LK",
  knowsAbout: [
    "E-sports tournaments",
    "VALORANT competitions",
    "YouTube livestreams",
    "Gaming community events",
  ],
};

export const websiteStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: siteTitle,
  alternateName: ["Quest Esports LK", "Quest Esports", "questesports.lk"],
  url: siteUrl,
  description: siteDescription,
  publisher: {
    "@type": "Organization",
    name: siteTitle,
  },
  potentialAction: {
    "@type": "SearchAction",
    target: `${siteUrl}/tournaments?game={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

export const buildTournamentStructuredData = (tournament: Tournament) => ({
  "@context": "https://schema.org",
  "@type": "SportsEvent",
  name: tournament.title,
  description:
    tournament.shortDescription ||
    tournament.fullDescription ||
    "Quest E-sports tournament event page.",
  image: absoluteUrl(tournament.bannerUrl || defaultSocialImage),
  url: absoluteUrl(`/tournaments/${tournament.slug}`),
  eventStatus: `https://schema.org/${
    tournament.status === "cancelled"
      ? "EventCancelled"
      : tournament.status === "completed"
        ? "EventCompleted"
        : "EventScheduled"
  }`,
  ...(tournament.startDate ? { startDate: tournament.startDate } : {}),
  ...(tournament.endDate ? { endDate: tournament.endDate } : {}),
  organizer: {
    "@type": "SportsOrganization",
    name: siteTitle,
    url: siteUrl,
  },
  sport: tournament.game,
  competitor: {
    "@type": "SportsTeam",
    name: `${tournament.teamSize}v${tournament.teamSize} teams`,
  },
  offers: {
    "@type": "Offer",
    url: absoluteUrl(`/tournaments/${tournament.slug}/register`),
    availability:
      tournament.registrationState === "registration_open"
        ? "https://schema.org/InStock"
        : "https://schema.org/SoldOut",
    price: tournament.registrationFee.amount,
    priceCurrency: tournament.registrationFee.currency,
  },
});

export const buildTicketEventStructuredData = (event: TicketedEvent) => ({
  "@context": "https://schema.org",
  "@type": "Event",
  name: event.title,
  description: event.description,
  image: absoluteUrl(defaultSocialImage),
  url: absoluteUrl(`/tickets/${event.slug}`),
  startDate: event.startsAt,
  eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
  eventStatus: `https://schema.org/${
    event.status === "cancelled"
      ? "EventCancelled"
      : event.status === "completed"
        ? "EventCompleted"
        : "EventScheduled"
  }`,
  location: {
    "@type": "Place",
    name: event.venue,
    address: {
      "@type": "PostalAddress",
      addressCountry: "LK",
    },
  },
  organizer: {
    "@type": "SportsOrganization",
    name: siteTitle,
    url: siteUrl,
  },
  offers: [
    {
      "@type": "Offer",
      name: "Single ticket",
      url: absoluteUrl(`/tickets/${event.slug}`),
      price: event.singlePrice,
      priceCurrency: event.currency,
      availability: event.salesActive
        ? "https://schema.org/InStock"
        : "https://schema.org/SoldOut",
      validFrom: event.salesStartAt,
      priceValidUntil: event.salesEndAt,
    },
    {
      "@type": "Offer",
      name: "Pair ticket",
      url: absoluteUrl(`/tickets/${event.slug}`),
      price: event.pairPrice,
      priceCurrency: event.currency,
      availability: event.salesActive
        ? "https://schema.org/InStock"
        : "https://schema.org/SoldOut",
      validFrom: event.salesStartAt,
      priceValidUntil: event.salesEndAt,
    },
  ],
});

export const buildProductStructuredData = (product: Product) => ({
  "@context": "https://schema.org",
  "@type": "Product",
  name: product.name,
  description: product.description,
  image: product.images.map((image) => absoluteUrl(image.imageUrl)),
  url: absoluteUrl(`/shop/${product.slug}`),
  brand: {
    "@type": "Brand",
    name: siteTitle,
  },
  offers: product.variants
    .filter((variant) => variant.isActive)
    .map((variant) => ({
      "@type": "Offer",
      name: variant.name,
      sku: variant.sku,
      url: absoluteUrl(`/shop/${product.slug}`),
      price: variant.price,
      priceCurrency: product.currency,
      availability:
        variant.stock === 0
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    })),
});

export const buildBreadcrumbStructuredData = (
  items: Array<{ name: string; path: string }>,
) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: absoluteUrl(item.path),
  })),
});

export type SiteNavItem = {
  href: string;
  /** Compact name for the header bar and the mobile sheet, where width is scarce. */
  label: string;
  /** Descriptive name for surfaces with room to spell it out, such as the footer. */
  fullLabel?: string;
  icon: NavIconKey;
};

/** The most descriptive name a surface can afford to show. */
export const siteNavLabel = (item: { label: string; fullLabel?: string }) =>
  item.fullLabel ?? item.label;

export const primaryNavItems: ReadonlyArray<SiteNavItem> = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/tournaments", label: "Tournaments", icon: "trophy" },
  {
    href: "/valorant-leaderboard",
    label: "Leaderboard",
    fullLabel: "Valorant Leaderboard",
    icon: "chart",
  },
  { href: "/match-videos", label: "Videos", fullLabel: "Match Videos", icon: "video" },
  { href: "/gallery", label: "Gallery", icon: "image" },
];

export const secondaryNavItems: ReadonlyArray<SiteNavItem> = [
  { href: "/shop", label: "Shop", icon: "shopping-bag" },
  { href: "/members", label: "Members", icon: "users" },
  { href: "/contact", label: "Contact", icon: "message" },
];

export const authNavItems = [
  { href: "/signup", label: "Sign Up" },
  { href: "/login", label: "Login" },
] as const;

export const socialLinks = [
  {
    href: "https://chat.whatsapp.com/G8XZXgYC4Ep1VYw1Zg5PIf",
    label: "Quest E-sports WhatsApp Community",
    icon: "/images/whatsapp.png",
  },
  {
    href: "https://discord.gg/cxkM7dk9CM",
    label: "Discord",
    icon: "/images/discord.png",
  },
  {
    href: "mailto:questesports.lk@gmail.com",
    label: "Email Quest E-sports",
    icon: "/images/gmail.png",
  },
  {
    href: "https://www.facebook.com/share/1HNNM3e9ub/?mibextid=wwXIfr",
    label: "Facebook",
    icon: "/images/facebook.png",
  },
  {
    href: "https://www.instagram.com/questesports.lk",
    label: "Instagram",
    icon: "/images/instagram.png",
  },
  {
    href: "https://www.tiktok.com/@senumii",
    label: "Senumi on TikTok",
    icon: "/images/tiktok.png",
  },
  {
    href: "https://www.tiktok.com/@questesports.lk",
    label: "Quest E-sports on TikTok (@questesports.lk)",
    icon: "/images/tiktok.png",
  },
] as const;

export const contactLinks = [
  {
    title: "Email & Social Media",
    items: [
      {
        label: "questesports.lk@gmail.com",
        href: "mailto:questesports.lk@gmail.com",
        icon: "/images/gmail.png",
      },
      {
        label: "Quest E-sports Discord",
        href: "https://discord.gg/cxkM7dk9CM",
        icon: "/images/discord.png",
      },
      {
        label: "Quest E-Sports LK",
        href: "https://www.facebook.com/share/1HNNM3e9ub/?mibextid=wwXIfr",
        icon: "/images/facebook.png",
      },
      {
        label: "@questesports.lk",
        href: "https://www.instagram.com/questesports.lk",
        icon: "/images/instagram.png",
      },
      {
        label: "@senumii",
        href: "https://www.tiktok.com/@senumii",
        icon: "/images/tiktok.png",
      },
      {
        label: "Quest E-sports TikTok (@questesports.lk)",
        href: "https://www.tiktok.com/@questesports.lk",
        icon: "/images/tiktok.png",
      },
    ],
  },
] as const;

export const whatsappContacts = [
  { label: "076 119 5666", href: "https://wa.me/94761195666" },
  { label: "076 718 6060", href: "https://wa.me/94767186060" },
] as const;

export const whatsappCommunityLink = {
  label: "Join the Quest E-sports WhatsApp Community",
  href: "https://chat.whatsapp.com/G8XZXgYC4Ep1VYw1Zg5PIf",
} as const;

export const teamMembers = [
  {
    name: "Sahan Jayasuriya",
    role: "Co-Owner",
    image: "/images/sahan.jpg",
  },
  {
    name: "Senumi Ekanayake",
    role: "Founder / Co-Owner ",
    image: "/images/senumi.jpg",
  },
  {
    name: "Russel Perera",
    role: "Co-Owner / Director",
    image: "/images/russel.jpg",
  },
  {
    name: "Deshika Peiris",
    role: "Head Admin",
    image: "/images/deshika.jpg",
  },
] as const;

export const defaultPageDescriptions = {
  home: siteDescription,
  tournaments:
    "Discover upcoming Quest E-sports tournaments, prize pools, registration windows, and featured competitive gaming events.",
  valorantLeaderboard:
    "Sri Lanka's Valorant player leaderboard — the country's top-ranked players by ELO, with rank, tier, and peak rank.",
  tournamentRegistration:
    "Enter a Quest E-sports tournament using its configured solo or team registration form.",
  registration:
    "Create and save your E-sports team, upload a logo, and invite members before entering tournaments.",
  login:
    "Access your Quest E-sports account to manage registrations, profiles, and tournament participation.",
  signup:
    "Create a Quest E-sports account to join tournaments, follow events, and stay ready for upcoming competitions.",
  profile: "View your account details and update your player profile.",
  admin: "Review user activity and monitor Quest E-sports account data.",
  adminUsers:
    "Create, update, and manage Quest E-sports user accounts and admin access.",
  adminTournaments:
    "Create, publish, edit, and manage Quest E-sports tournaments.",
  adminRegistrations:
    "Review registrations, approvals, payments, and verification states.",
  adminContactMessages:
    "Read and manage incoming contact messages from the website.",
  matchVideos:
    "Watch official Quest E-sports tournament broadcasts, YouTube match replays, highlights, and livestream archives.",
  gallery:
    "Browse Quest E-sports event photography organised into albums from tournaments, expos, and community events.",
  shop: "Shop Quest E-sports apparel and made-to-order merchandise with secure online checkout.",
  members: "Quest E-sports members and community leadership.",
  join: "Apply to join Quest E-sports as a solo player, existing team, or incomplete roster looking for teammates.",
  rulebook:
    "Read the official Quest E-sports VALORANT tournament rules, eligibility guidelines, and match conduct standards.",
  contact:
    "Contact Quest E-sports for tournament inquiries, sponsorship conversations, community support, and collaboration requests.",
  termsOfService:
    "Read the terms that govern use of Quest E-sports accounts, tournaments, content submissions, and platform services.",
  privacyPolicy:
    "Read how Quest E-sports collects, uses, stores, and protects personal information across accounts, tournament registration, and support flows.",
} as const;
