import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { activeTouches, directInput } from './tests/browser/direct-input.js';

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
        // Browser-dispatched contacts exercise real pointer capture, TouchEvents
        // and compatibility mouse events, rather than synthetic DOM events.
        async touchContact({ page, iframe }, action: 'start' | 'move' | 'end' | 'cancel', points: { id: number; x: number; y: number }[]) {
          const session = await directInput(page);
          if ((action === 'end' || action === 'cancel') && !activeTouches.has(session)) return;
          const bounds = points.length ? await iframe.locator('canvas').boundingBox() : null;
          if (!bounds && points.length) throw new Error('Map canvas is not visible');
          if (action === 'start' && !activeTouches.has(session)) await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
          await session.send('Input.dispatchTouchEvent', {
            type: ({ start: 'touchStart', move: 'touchMove', end: 'touchEnd', cancel: 'touchCancel' } as const)[action],
            touchPoints: points.map(point => ({ id: point.id, x: bounds!.x + point.x, y: bounds!.y + point.y, radiusX: 8, radiusY: 8, force: 1 })),
          });
          if (action === 'start') activeTouches.add(session);
          if (action === 'end' || action === 'cancel') activeTouches.delete(session);
        },
        async penContact({ page, iframe }, action: 'down' | 'move' | 'up', x: number, y: number) {
          const bounds = await iframe.locator('canvas').boundingBox();
          if (!bounds) throw new Error('Map canvas is not visible');
          const session = await directInput(page);
          await session.send('Input.dispatchMouseEvent', { type: ({ down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' } as const)[action],
            x: bounds.x + x, y: bounds.y + y, pointerType: 'pen', button: 'left', buttons: action === 'up' ? 0 : 1, clickCount: action === 'move' ? 0 : 1 });
        },
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
