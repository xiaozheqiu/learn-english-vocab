import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        card: "var(--card)",
        ink: {
          DEFAULT: "var(--ink)",
          soft: "var(--ink-soft)",
          mute: "var(--ink-mute)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          ink: "var(--brand-ink)",
          deep: "var(--brand-deep)",
          wash: "var(--brand-wash)",
          500: "var(--brand-500)",
        },
        line: "var(--line)",
        due: {
          DEFAULT: "var(--due)",
          wash: "var(--due-wash)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          wash: "var(--danger-wash)",
        },
        // shadcn 兼容层
        border: "var(--line)",
        input: "var(--line)",
        ring: "var(--brand)",
        background: "var(--paper)",
        foreground: "var(--ink)",
        primary: {
          DEFAULT: "var(--brand)",
          foreground: "var(--card)",
        },
        secondary: {
          DEFAULT: "var(--brand-wash)",
          foreground: "var(--brand-ink)",
        },
        muted: {
          DEFAULT: "var(--paper)",
          foreground: "var(--ink-mute)",
        },
        accent: {
          DEFAULT: "var(--brand-wash)",
          foreground: "var(--brand-ink)",
        },
        destructive: {
          DEFAULT: "var(--danger)",
          foreground: "var(--card)",
        },
      },
      borderRadius: {
        card: "14px",
        btn: "10px",
        lg: "10px",
        md: "8px",
        sm: "6px",
      },
      fontFamily: {
        serif: [
          "ui-serif",
          "Iowan Old Style",
          "Palatino Linotype",
          "Source Han Serif SC",
          "Songti SC",
          "Georgia",
          "serif",
        ],
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,32,27,.04), 0 12px 32px -24px rgba(16,32,27,.35)",
        float: "0 24px 70px -24px rgba(16,32,27,.35)",
      },
      transitionTimingFunction: {
        panel: "cubic-bezier(.22,1,.36,1)",
      },
      keyframes: {
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-7px)" },
          "40%": { transform: "translateX(7px)" },
          "60%": { transform: "translateX(-4px)" },
          "80%": { transform: "translateX(4px)" },
        },
      },
      animation: {
        shake: "shake 320ms ease-in-out",
      },
    },
  },
  plugins: [animate],
};
