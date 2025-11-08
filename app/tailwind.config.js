/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'pump-green': '#00ff88',
        'pump-red': '#ff0055',
        'pump-dark': '#0a0a0a',
        'pump-gray': '#1a1a1a',
      },
    },
  },
  plugins: [],
}
