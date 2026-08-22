// Single source of truth for the stroked 20x20 glyphs used by the public
// navigation and the admin sidebar. Keeping the paths here lets both shells
// share one visual language instead of maintaining separate icon sets.
export type NavIconKey =
  | "book" | "calendar" | "chart" | "clipboard" | "crosshair" | "credit-card"
  | "dashboard" | "gamepad" | "home" | "image" | "layers" | "logout" | "message"
  | "monitor" | "package" | "receipt" | "shield" | "shopping-bag" | "swords"
  | "ticket" | "trophy" | "user" | "user-plus" | "users" | "video";

export const navIconPaths: Record<NavIconKey, string> = {
  book: "M4 4.5A2.5 2.5 0 0 1 6.5 2H17v15H6.5A2.5 2.5 0 0 0 4 19.5V4.5ZM4 4.5A2.5 2.5 0 0 0 1.5 2H1v15h5.5A2.5 2.5 0 0 1 9 19.5V2",
  calendar: "M4 3v3M16 3v3M2.5 8h15M4 5h12a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 16 18H4a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 4 5Z",
  chart: "M3 17h14M6.5 17v-5M10 17V6M13.5 17v-8",
  clipboard: "M7 3h6v3H7V3ZM5 4H3.5v14h13V4H15M6 10h8M6 14h5",
  crosshair: "M10 2v3M10 15v3M2 10h3M15 10h3M10 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  "credit-card": "M2 5.5h16v10H2v-10ZM2 9h16M5 13h3",
  dashboard: "M3 3h6v6H3V3ZM11 3h6v6h-6V3ZM3 11h6v6H3v-6ZM11 11h6v6h-6v-6Z",
  gamepad: "m5 7-2 1.5A4 4 0 0 0 5 16l1.5-2h7L15 16a4 4 0 0 0 2-7.5L15 7H5ZM6 10v3M4.5 11.5h3M13.5 11h.01M16 11h.01",
  home: "m2.5 8.5 7.5-6 7.5 6M4.5 7.5V17h4v-5h3v5h4V7.5",
  image: "m3 4 5 5 3-3 6 6M3 4h14v12H3V4ZM6 7h.01",
  layers: "m10 3 7 4-7 4-7-4 7-4ZM3 10l7 4 7-4M3 13l7 4 7-4",
  logout: "M11.5 3H4v14h7.5M9 10h8.5m-3-3 3 3-3 3",
  message: "M3 4h14v12H3V4ZM3 5l7 6 7-6",
  monitor: "M3 3h14v10H3V3ZM8 17h4M10 13v4",
  package: "m10 2 7 4v8l-7 4-7-4V6l7-4ZM3 6l7 4 7-4M10 10v8",
  receipt: "M5 2h10v16l-2-1-3 1-3-1-2 1V2ZM7 6h6M7 10h6M7 14h3",
  shield: "m10 2.5 6 2.2v4.8c0 3.4-2.4 6.4-6 8-3.6-1.6-6-4.6-6-8V4.7l6-2.2ZM7.5 10l2 2 3.5-3.5",
  "shopping-bag": "M4 6h12l1 11H3L4 6ZM7 6a3 3 0 0 1 6 0",
  swords: "m5 3 5 5m0 0 5-5m-5 5L5 17m5-9 5 9M3 3l2 2m12-2-2 2",
  ticket: "M3 5h14v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V5ZM10 6v8",
  trophy: "M6 3h8v4a4 4 0 0 1-8 0V3ZM4 4H2v2a3 3 0 0 0 3 3M16 4h2v2a3 3 0 0 1-3 3M10 11v4M7 18h6M8 15h4",
  user: "M16.5 17.5v-1.5a4 4 0 0 0-4-4h-5a4 4 0 0 0-4 4v1.5M10 8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  "user-plus": "M12 17v-1a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v1M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 8v6M13 11h6",
  users: "M13 17v-1a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v1M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14 3.2a3 3 0 0 1 0 5.8M14 13h1a3 3 0 0 1 3 3v1",
  video: "M2.5 5h10v10h-10V5ZM12.5 9l5-2.75v7.5L12.5 11",
};
