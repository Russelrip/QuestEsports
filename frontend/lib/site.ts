import type { Metadata } from "next";
import type { Tournament } from "@/lib/tournaments";

const siteName = "Quest Esports";
const siteTitle = "Quest Esports LK";
const siteDescription =
  "Quest Esports runs Sri Lankan esports tournaments, match broadcasts, posters, and community events built for competitive players and gaming fans.";
const fallbackSiteUrl =
  process.env.NODE_ENV === "production" ? "https://questesports.lk" : "http://localhost:3000";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || fallbackSiteUrl;
const creatorHandle = "@questesportslk";
const defaultLocale = "en_US";
const defaultSocialImage = "/images/banner.jpg";

const defaultKeywords = [
  "Quest Esports",
  "Quest Esports LK",
  "Sri Lanka esports",
  "Sri Lankan gaming tournaments",
  "esports tournaments",
  "VALORANT tournament",
  "gaming community Sri Lanka",
  "competitive gaming",
  "match livestreams",
  "esports posters",
];

const channelKeywords = {
  youtube: [
    "YouTube gaming",
    "esports highlights",
    "match replays",
    "live stream tournament",
  ],
  instagram: [
    "Instagram gaming content",
    "esports reels",
    "gaming highlights",
    "community updates",
  ],
  tiktok: [
    "TikTok gaming",
    "short-form esports clips",
    "gaming edits",
    "viral esports moments",
  ],
  linkedin: [
    "esports brand",
    "gaming events",
    "community partnerships",
    "creator collaborations",
  ],
  appStores: [
    "mobile esports",
    "tournament registration",
    "gaming event updates",
    "player community",
  ],
} as const;

const defaultOpenGraphImage = {
  url: defaultSocialImage,
  width: 1200,
  height: 630,
  alt: `${siteTitle} social share banner`,
};

export const siteMetadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${siteTitle} | Sri Lanka Esports Tournaments & Match Highlights`,
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
  classification: "Esports and gaming community",
  openGraph: {
    type: "website",
    locale: defaultLocale,
    url: siteUrl,
    title: `${siteTitle} | Sri Lanka Esports Tournaments & Match Highlights`,
    description: siteDescription,
    siteName: siteName,
    images: [defaultOpenGraphImage],
  },
  twitter: {
    card: "summary_large_image",
    creator: creatorHandle,
    title: `${siteTitle} | Sri Lanka Esports Tournaments & Match Highlights`,
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
    icon: "/images/logo-new.png",
    shortcut: "/images/logo-new.png",
    apple: "/images/logo-new.png",
  },
  manifest: "/manifest.webmanifest",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
  },
};

type PageMetadataOptions = {
  title: string;
  description: string;
  path: string;
  keywords?: string[];
  image?: string;
  type?: "website" | "article";
  noIndex?: boolean;
};

const mergeKeywords = (...keywords: Array<readonly string[] | undefined>) =>
  Array.from(
    new Set([
      ...defaultKeywords,
      ...keywords.flatMap((entry) => entry ?? []),
    ])
  );

const resolvePath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

export const absoluteUrl = (path = "/") => new URL(resolvePath(path), siteUrl).toString();

export const buildPageMetadata = ({
  title,
  description,
  path,
  keywords,
  image = defaultSocialImage,
  type = "website",
  noIndex = false,
}: PageMetadataOptions): Metadata => {
  const canonicalPath = resolvePath(path);
  const pageTitle = `${title} | ${siteTitle}`;

  return {
    title,
    description,
    keywords: mergeKeywords(
      keywords,
      channelKeywords.youtube,
      channelKeywords.instagram,
      channelKeywords.tiktok,
      channelKeywords.linkedin,
      channelKeywords.appStores
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
    `${tournament.game} esports`,
    "esports event",
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
  path: string
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
  url: siteUrl,
  logo: absoluteUrl("/images/logo-new.png"),
  image: absoluteUrl(defaultSocialImage),
  description: siteDescription,
  email: "contact@mail.questesports.lk",
  sameAs: [
    "https://discord.gg/cxkM7dk9CM",
    "https://www.facebook.com/share/1HNNM3e9ub/?mibextid=wwXIfr",
    "https://www.instagram.com/questesportslk/",
    "https://www.tiktok.com/@senumii",
    "https://www.youtube.com/",
    "https://www.linkedin.com/",
  ],
  areaServed: "LK",
  knowsAbout: [
    "Esports tournaments",
    "VALORANT competitions",
    "YouTube livestreams",
    "Gaming community events",
  ],
};

export const websiteStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: siteTitle,
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
    "Quest Esports tournament event page.",
  image: absoluteUrl(tournament.bannerUrl || defaultSocialImage),
  url: absoluteUrl(`/tournaments/${tournament.slug}`),
  eventStatus: `https://schema.org/${
    tournament.status === "cancelled"
      ? "EventCancelled"
      : tournament.status === "completed"
        ? "EventCompleted"
        : "EventScheduled"
  }`,
  startDate: tournament.startDate,
  endDate: tournament.endDate,
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
    url: absoluteUrl("/tournament-registration"),
    availability:
      tournament.registrationState === "registration_open"
        ? "https://schema.org/InStock"
        : "https://schema.org/SoldOut",
    price: 0,
    priceCurrency: "LKR",
  },
});

export const primaryNavItems = [
  { href: "/", label: "Home" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/match-videos", label: "Match Videos" },
  { href: "/posters", label: "Posters" },
  { href: "/rulebook", label: "Rulebook" },
] as const;

export const authNavItems = [
  { href: "/signup", label: "Sign Up" },
  { href: "/login", label: "Login" },
] as const;

export const socialLinks = [
  {
    href: "https://api.whatsapp.com/send?phone=94761195666",
    label: "WhatsApp",
    icon: "/images/whatsapp.png",
  },
  {
    href: "https://discord.gg/cxkM7dk9CM",
    label: "Discord",
    icon: "/images/discord.png",
  },
  {
    href: "https://accounts.google.com/",
    label: "Gmail",
    icon: "/images/gmail.png",
  },
  {
    href: "https://www.facebook.com/share/1HNNM3e9ub/?mibextid=wwXIfr",
    label: "Facebook",
    icon: "/images/facebook.png",
  },
  {
    href: "https://www.instagram.com/questesportslk/",
    label: "Instagram",
    icon: "/images/instagram.png",
  },
  {
    href: "https://www.tiktok.com/@senumii",
    label: "TikTok",
    icon: "/images/tiktok.png",
  },
] as const;

export const contactLinks = [
  {
    title: "Social Media",
    items: [
      {
        label: "contact@mail.questesports.lk",
        href: "mailto:contact@mail.questesports.lk",
        icon: "/images/gmail.png",
      },
      {
        label: "Quest Esports Discord",
        href: "https://discord.gg/cxkM7dk9CM",
        icon: "/images/discord.png",
      },
      {
        label: "Quest E-Sports LK",
        href: "https://www.facebook.com/share/1HNNM3e9ub/?mibextid=wwXIfr",
        icon: "/images/facebook.png",
      },
      {
        label: "@questesportslk",
        href: "https://www.instagram.com/questesportslk/",
        icon: "/images/instagram.png",
      },
      {
        label: "@senumii",
        href: "https://www.tiktok.com/@senumii",
        icon: "/images/tiktok.png",
      },
    ],
  },
] as const;

export const whatsappContacts = [
  { label: "076 119 5666", href: "https://wa.me/94761195666" },
  { label: "076 718 6060", href: "https://wa.me/94767186060" },
] as const;

export const teamMembers = [
  {
    name: "Sahan Jayasuriya",
    role: "Owner",
    image: "/images/sahan.jpg",
  },
  {
    name: "Senumi Ekanayake",
    role: "Owner / Founder",
    image: "/images/senumi.jpg",
  },
  {
    name: "Russel Perera",
    role: "Director / Co-Owner",
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
  tournaments: "Discover upcoming Quest Esports tournaments, prize pools, registration windows, and featured competitive gaming events.",
  tournamentRegistration:
    "Register your team for Quest Esports events with player details, roster info, and tournament-ready submissions.",
  registration:
    "Join the Quest Esports community and submit your team for competitive gaming events and upcoming tournaments.",
  login: "Access your Quest Esports account to manage registrations, profiles, and tournament participation.",
  signup:
    "Create a Quest Esports account to join tournaments, follow events, and stay ready for upcoming competitions.",
  profile: "View your account details and update your player profile.",
  admin: "Review user activity and monitor Quest Esports account data.",
  adminUsers: "Create, update, and manage Quest Esports user accounts and admin access.",
  adminTournaments: "Create, publish, edit, and manage Quest Esports tournaments.",
  adminRegistrations: "Review registrations, approvals, payments, and verification states.",
  adminContactMessages: "Read and manage incoming contact messages from the website.",
  matchVideos:
    "Watch official Quest Esports tournament broadcasts, YouTube match replays, highlights, and livestream archives.",
  posters:
    "Browse Quest Esports tournament posters, promotional creatives, social visuals, and event announcement graphics.",
  rulebook:
    "Read the official Quest Esports VALORANT tournament rules, eligibility guidelines, and match conduct standards.",
  contact:
    "Contact Quest Esports for tournament inquiries, sponsorship conversations, community support, and collaboration requests.",
  termsOfService:
    "Read the terms that govern use of Quest Esports accounts, tournaments, content submissions, and platform services.",
  privacyPolicy:
    "Read how Quest Esports collects, uses, stores, and protects personal information across accounts, tournament registration, and support flows.",
} as const;
