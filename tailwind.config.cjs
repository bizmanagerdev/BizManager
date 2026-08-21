/* eslint-disable @typescript-eslint/no-require-imports */
/** @type {import('tailwindcss').Config} */
const withAlpha = (v) => `rgb(var(--${v}) / <alpha-value>)`;

const primitiveScale = (name, stops) =>
  Object.fromEntries(stops.map((n) => [String(n), withAlpha(`${name}-${n}`)]));

module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Semantic tokens (preferred — components reference these) */
        border: withAlpha("border"),
        input: withAlpha("input"),
        ring: withAlpha("ring"),
        background: withAlpha("background"),
        foreground: withAlpha("foreground"),
        primary: {
          DEFAULT: withAlpha("primary"),
          foreground: withAlpha("primary-foreground"),
          ...primitiveScale("primary", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        },
        secondary: {
          DEFAULT: withAlpha("secondary"),
          foreground: withAlpha("secondary-foreground"),
          ...primitiveScale("secondary", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        },
        destructive: {
          DEFAULT: withAlpha("destructive"),
          foreground: withAlpha("destructive-foreground"),
          soft: withAlpha("destructive-soft"),
          "soft-foreground": withAlpha("destructive-soft-foreground"),
          strong: withAlpha("destructive-strong"),
        },
        muted: {
          DEFAULT: withAlpha("muted"),
          foreground: withAlpha("muted-foreground"),
        },
        accent: {
          DEFAULT: withAlpha("accent"),
          foreground: withAlpha("accent-foreground"),
        },
        popover: {
          DEFAULT: withAlpha("popover"),
          foreground: withAlpha("popover-foreground"),
        },
        card: {
          DEFAULT: withAlpha("card"),
          foreground: withAlpha("card-foreground"),
        },
        success: {
          DEFAULT: withAlpha("success"),
          foreground: withAlpha("success-foreground"),
          soft: withAlpha("success-soft"),
          "soft-foreground": withAlpha("success-soft-foreground"),
          strong: withAlpha("success-strong"),
        },
        warning: {
          DEFAULT: withAlpha("warning"),
          foreground: withAlpha("warning-foreground"),
          soft: withAlpha("warning-soft"),
          "soft-foreground": withAlpha("warning-soft-foreground"),
          strong: withAlpha("warning-strong"),
        },
        info: {
          DEFAULT: withAlpha("info"),
          foreground: withAlpha("info-foreground"),
          soft: withAlpha("info-soft"),
          "soft-foreground": withAlpha("info-soft-foreground"),
          strong: withAlpha("info-strong"),
        },
        sidebar: {
          DEFAULT: withAlpha("sidebar-background"),
          foreground: withAlpha("sidebar-foreground"),
          primary: withAlpha("sidebar-primary"),
          "primary-foreground": withAlpha("sidebar-primary-foreground"),
          accent: withAlpha("sidebar-accent"),
          "accent-foreground": withAlpha("sidebar-accent-foreground"),
          border: withAlpha("sidebar-border"),
          ring: withAlpha("sidebar-ring"),
        },

        /* Primitive palette scales (for fine-grained usage in feature files;
           prefer semantic tokens above whenever possible) */
        brand: {
          ...primitiveScale("primary", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        },
        accentSky: {
          ...primitiveScale("secondary", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        },
        /* Functional palettes — single anchor (-4) plus light tints (-8/-9/-10)
           for backgrounds. Use the semantic tokens (success, warning, etc.)
           instead of these wherever possible. */
        palette: {
          blue: primitiveScale("blue", [4, 8, 9, 10]),
          green: primitiveScale("green", [4, 8, 9, 10]),
          yellow: primitiveScale("yellow", [4, 8, 9, 10]),
          orange: primitiveScale("orange", [4, 8, 9, 10]),
          red: primitiveScale("red", [4, 8, 9, 10]),
          purple: primitiveScale("purple", [4, 8, 9, 10]),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        "bell-ring": {
          "0%, 50%, 100%": { transform: "rotate(0deg)" },
          "5%": { transform: "rotate(14deg)" },
          "10%": { transform: "rotate(-12deg)" },
          "15%": { transform: "rotate(10deg)" },
          "20%": { transform: "rotate(-8deg)" },
          "25%": { transform: "rotate(5deg)" },
          "30%": { transform: "rotate(0deg)" },
        },
        "progress-indeterminate": {
          "0%": { transform: "translateX(-100%) scaleX(0.35)" },
          "50%": { transform: "translateX(0%) scaleX(0.55)" },
          "100%": { transform: "translateX(100%) scaleX(0.35)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        "bell-ring": "bell-ring 2.5s ease-in-out infinite",
        "progress-indeterminate": "progress-indeterminate 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
