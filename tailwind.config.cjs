/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        accent: 'var(--accent)'
      }
    }
  },
  plugins: []
};
