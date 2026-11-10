// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Required for absolute Open Graph image URLs in link previews
  // site: 'https://your-domain.com',
  vite: {
    plugins: [tailwindcss()]
  }
});