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
        slideup: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slidedown: { '0%': { opacity: '0', transform: 'translateY(-100%)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        dot: { '0%,80%,100%': { transform: 'scale(0.6)', opacity: '0.4' }, '40%': { transform: 'scale(1)', opacity: '1' } },
      },
      animation: {
        fadeout: 'fadeout 3s ease-in forwards',
        shake: 'shake 0.35s',
        pop: 'pop 0.15s ease-out',
        slideup: 'slideup 0.22s ease-out',
        slidedown: 'slidedown 0.25s ease-out',
        dot: 'dot 1.2s infinite ease-in-out',
      },
    },
  },
  plugins: [],
};
