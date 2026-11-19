/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        sunset: {
          gold: '#ffbe6b',
          amber: '#f59e0b',
          ember: '#e06d53',
          dusk: '#1f293d',
          slate: '#0e1015',
        },
      },
    },
  },
  plugins: [],
};
