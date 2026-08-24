import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // CocoNet brand — navy ink + royal blue + link-orange (from the logo mark).
        ink: {
          DEFAULT: '#0E1B2E',
          soft: '#1B2A40',
        },
        brand: {
          50: '#EEF3FB',
          100: '#DCE7F6',
          200: '#B9CEEC',
          300: '#8FADDE',
          400: '#5B84CB',
          500: '#2F5CB8',
          600: '#264CA0',
          700: '#1F3F85',
          DEFAULT: '#2F5CB8',
          dark: '#1F3F85',
        },
        accent: {
          50: '#FEF4EC',
          100: '#FDE6D3',
          200: '#F9C79E',
          300: '#F2A567',
          400: '#EC8B40',
          500: '#E1782B',
          600: '#C86420',
          DEFAULT: '#EC8B40',
          dark: '#C86420',
        },
        surface: {
          DEFAULT: '#F4F7FB',
          sunken: '#EBF0F7',
        },
        line: '#E4EAF2',
        // Landing accents (ofspace-style dark + lime).
        lime: {
          300: '#E0F29E',
          DEFAULT: '#CFEB6E',
          500: '#CFEB6E',
          600: '#BBDC4E',
        },
        night: {
          DEFAULT: '#141615',
          soft: '#1E211F',
          card: '#212423',
        },
        paper: '#F1F2ED',
      },
      fontFamily: {
        sans: ['var(--font-plex-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(14,27,46,0.04), 0 1px 3px rgba(14,27,46,0.06)',
        elevated: '0 10px 30px -12px rgba(14,27,46,0.18), 0 2px 8px rgba(14,27,46,0.06)',
        glow: '0 0 0 1px rgba(47,92,184,0.15), 0 8px 24px -8px rgba(47,92,184,0.35)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(47,92,184,0.35)' },
          '70%': { boxShadow: '0 0 0 8px rgba(47,92,184,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(47,92,184,0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        pulseRing: 'pulseRing 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
