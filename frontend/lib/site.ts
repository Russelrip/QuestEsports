export const siteMetadata = {
  title: "Quest Esports",
  description: "Quest Esports website",
};

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
    href: "https://www.instagram.com/",
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
        label: "questesportslk@gmail.com",
        href: "mailto:questesportslk@gmail.com",
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
        href: "https://www.instagram.com/",
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
  tournaments: "Explore Quest Esports events and upcoming competitions",
  tournamentRegistration: "Register your team for upcoming tournaments",
  registration: "Join Quest Esports tournaments",
  login: "Access your Quest Esports account",
  signup: "Join Quest Esports and start competing",
  profile: "View your account details and update your player profile",
  admin: "Review user activity and monitor Quest Esports account data",
  adminUsers: "Create, update, and manage Quest Esports user accounts and admin access",
  adminTournaments: "Create, publish, edit, and manage Quest Esports tournaments",
  adminRegistrations: "Review registrations, approvals, payments, and verification states",
  adminContactMessages: "Read and manage incoming contact messages from the website",
  matchVideos: "Watch official Quest Esports tournament uploads and live matches",
  posters: "Tournament posters, highlights, and community event visuals",
  rulebook: "Official VALORANT Tournament Rules",
  contact: "Get in touch with Quest Esports",
} as const;
