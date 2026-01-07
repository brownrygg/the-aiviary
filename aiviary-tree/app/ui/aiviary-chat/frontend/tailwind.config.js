import typography from '@tailwindcss/typography';

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        atmosphere: {
          sky: '#C2E0FF',
          sand: '#F7F5F0',
        },
        brand: {
          teal: '#2C4A52',
          clay: '#BF5B28',
          'clay-hover': '#A64D21',
        },
        neutral: {
          charcoal: '#2C3333',
          slate: '#6B7C85',
          mist: 'rgba(255, 255, 255, 0.65)',
        }
      },
      fontFamily: {
        serif: ['Lora', 'serif'],
        sans: ['Inter', 'sans-serif'],
      },
      backgroundImage: {
        'sky-to-earth': 'linear-gradient(180deg, #C2E0FF 0%, #F7F5F0 100%)',
      }
    },
  },
  plugins: [
    typography,
  ],
}
