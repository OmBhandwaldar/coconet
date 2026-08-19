import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#4f46e5', dark: '#3730a3' },
      },
    },
  },
  plugins: [],
};

export default config;
