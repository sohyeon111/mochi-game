import { defineConfig } from 'vitest/config';

// GitHub Pages 하위 경로(/mochi-game/)에서도 동작하도록 상대경로 사용
export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
