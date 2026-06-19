/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./web/index.html', './web/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        accent: 'var(--accent)'
      }
    }
  },
  plugins: []
};
