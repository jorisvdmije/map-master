import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/browser/**/*.test.ts'],
    // Bound concurrent WebGL maps so software rendering does not starve input/readiness checks.
    maxWorkers: 4,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    browser: {
      enabled: true,
      commands: {
        // Keep a real mouse gesture open across assertions (Alt/options/cleanup).
        async vertexPointer({ page, iframe }, action: 'down' | 'move' | 'up', x: number, y: number) {
          const bounds = await iframe.locator('canvas').boundingBox();
          if (!bounds) throw new Error('Map canvas is not visible');
          await page.mouse.move(bounds.x + x, bounds.y + y);
          if (action === 'down') await page.mouse.down();
          if (action === 'up') await page.mouse.up();
        },
      },
      viewport: { width: 1000, height: 800 },
      headless: true,
      provider: playwright({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
