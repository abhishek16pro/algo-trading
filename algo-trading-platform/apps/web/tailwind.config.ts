import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0b0f14', card: '#0f1620', accent: '#101a2b' },
        ink: { DEFAULT: '#e6edf3', muted: '#8b98a5' },
        brand: { DEFAULT: '#3a86ff', hover: '#5d9cff' },
        pos: '#22c55e',
        neg: '#ef4444',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] },
    },
  },
  plugins: [],
};

export default config;
