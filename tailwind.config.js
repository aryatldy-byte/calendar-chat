/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./pages/**/*.{js,jsx}', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        wa: { dark: '#075E54', teal: '#128C7E', green: '#25D366', bubble: '#d9fdd3', bg: '#efeae2' },
      },
      keyframes: {
        fadeout: { '0%': { opacity: '1' }, '100%': { opacity: '0', transform: 'scale(0.96)' } },
        shake: {
          '0%,100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-8px)' },
          '75%': { transform: 'translateX(8px)' },
        },
        pop: { '0%': { opacity: '0', transform: 'scale(0.96)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
      },
      animation: {
        fadeout: 'fadeout 3s ease-in forwards',
        shake: 'shake 0.35s',
        pop: 'pop 0.15s ease-out',
      },
    },
  },
  plugins: [],
};
