export const designTokens = {
  spacing: {
    xs: "0.5rem",
    sm: "0.75rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
    "2xl": "3rem",
    "3xl": "4rem",
  },
  typography: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
    "3xl": "2rem",
    "4xl": "3rem",
    "5xl": "4rem",
  },
  colors: {
    bg: "#05030b",
    bgElevated: "#0d0a17",
    card: "rgba(12,12,20,0.78)",
    cardStrong: "rgba(17,17,28,0.94)",
    accent: "#8b5cf6",
    accentAlt: "#22d3ee",
    foreground: "#f8fafc",
    muted: "#94a3b8",
    border: "rgba(255,255,255,0.10)",
    success: "#86efac",
    warning: "#fcd34d",
    danger: "#fda4af",
    info: "#67e8f9",
  },
  radius: {
    sm: "1rem",
    md: "1.5rem",
    lg: "1.75rem",
    xl: "2rem",
  },
  shadows: {
    sm: "0 12px 32px rgba(0,0,0,0.22)",
    md: "0 24px 70px rgba(0,0,0,0.28)",
    lg: "0 28px 100px rgba(0,0,0,0.35)",
  },
} as const;

const toCssVars = (record: Record<string, string>, prefix: string) =>
  Object.entries(record)
    .map(([key, value]) => `--${prefix}-${key}: ${value};`)
    .join("\n");

export const designTokenCssVariables = `
:root {
${toCssVars(designTokens.spacing, "space")}
${toCssVars(designTokens.typography, "font-size")}
${toCssVars(designTokens.colors, "color")}
${toCssVars(designTokens.radius, "radius")}
${toCssVars(designTokens.shadows, "shadow")}
}
`;
