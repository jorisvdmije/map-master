import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/browser/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    browser: {
      enabled: true,
      viewport: { width: 1000, height: 800 },
      headless: true,
      provider: playwright({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
