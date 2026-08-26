// Tailwind runs entirely through the @tailwindcss/vite plugin (see
// vite.config.ts) -- no PostCSS plugins are needed here. Without this file,
// PostCSS's config search walks up past this project's own directory and can
// pick up an unrelated postcss.config.js elsewhere on disk, breaking the
// build with an unrelated "Cannot find module" error.
export default {
  plugins: {},
};
