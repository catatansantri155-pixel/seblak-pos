import type { Config } from "tailwindcss";

// Pemetaan design token Sinta (G1 — Design Tokens & Struktur AppShell,
// dokumen artefak Living World id 7) ke tema Tailwind:
// - warna inti & turunan persis §2.1 (canvas #FAFAF8, primary #F97316, dst.)
// - tipografi §2.2: Plus Jakarta Sans (display) + Inter (body)
// - radius §2.4: md 12px, lg 16px, xl 20px, full 999px (bawaan Tailwind)
// - spacing: skala bawaan Tailwind berbasis 4px sudah sesuai §2.3
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FAFAF8",
        surface: "#FFFFFF",
        subtle: "#F1F5F9",
        primary: {
          DEFAULT: "#F97316",
          hover: "#EA580C",
          text: "#C2410C",
          soft: "#FFF7ED",
        },
        ink: "#0F172A",
        secondary: "#475569",
        muted: "#64748B",
        line: {
          DEFAULT: "#E2E8F0",
          strong: "#CBD5E1",
        },
        success: { DEFAULT: "#15803D", bg: "#F0FDF4" },
        warning: { DEFAULT: "#B45309", bg: "#FFFBEB" },
        danger: { DEFAULT: "#B91C1C", bg: "#FEF2F2" },
        info: { DEFAULT: "#1D4ED8", bg: "#EFF6FF" },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      fontSize: {
        display: ["28px", { lineHeight: "36px", fontWeight: "800" }],
        h1: ["24px", { lineHeight: "32px", fontWeight: "700" }],
        h2: ["20px", { lineHeight: "28px", fontWeight: "700" }],
        h3: ["16px", { lineHeight: "24px", fontWeight: "600" }],
        "price-lg": ["20px", { lineHeight: "28px", fontWeight: "800" }],
        price: ["16px", { lineHeight: "24px", fontWeight: "700" }],
      },
      borderRadius: {
        md: "12px",
        lg: "16px",
        xl: "20px",
      },
    },
  },
  plugins: [],
} satisfies Config;
