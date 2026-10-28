import type { CDPSession, Page } from 'playwright';

const sessions = new WeakMap<Page, CDPSession>();
export const activeTouches = new WeakSet<CDPSession>();
export async function directInput(page: Page): Promise<CDPSession> {
  let session = sessions.get(page);
  if (!session) { session = await page.context().newCDPSession(page); sessions.set(page, session); }
  return session;
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    touchContact(action: 'start' | 'move' | 'end' | 'cancel', points: { id: number; x: number; y: number }[]): Promise<void>;
    penContact(action: 'down' | 'move' | 'up', x: number, y: number): Promise<void>;
  }
}
