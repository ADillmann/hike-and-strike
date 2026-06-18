/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        dungeon: {
          900: '#1a1410',
          800: '#2a2118',
          700: '#3d3228',
          600: '#5c4a3a',
          500: '#8b6914',
          400: '#c9a227',
          300: '#e8c547',
        },
      },
    },
  },
  plugins: [],
}
