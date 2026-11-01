import { expect, it } from 'vitest';
import { resolveKeyboardShortcuts, type KeyboardShortcuts } from '../src/core/keyboard-shortcuts.js';

it('patches alternatives without sharing caller, default or returned arrays', () => {
  const update: KeyboardShortcuts = { polygon: [{ key: 'P', modifiers: ['Shift'] }], delete: false };
  const first = resolveKeyboardShortcuts(update);
  expect(first.polygon).toEqual([{ key: 'p', modifiers: ['Shift'] }]);
  expect(first.delete).toEqual([]);
  expect(first.undo).toHaveLength(2);
  const next = resolveKeyboardShortcuts({ finish: [{ key: 'f' }] }, first);
  first.polygon[0]!.key = 'x'; first.undo.length = 0;
  expect(next.polygon[0]!.key).toBe('p');
  expect(next.undo).toHaveLength(2);
  expect(update.polygon).toEqual([{ key: 'P', modifiers: ['Shift'] }]);
  expect(resolveKeyboardShortcuts().undo).toHaveLength(2);
});

it('rejects ambiguous bindings on either Mod platform, including duplicate alternatives', () => {
  for (const update of [
    { point: [{ key: 'z', modifiers: ['Mod'] }] },
    { point: [{ key: 'X' }], line: [{ key: 'x' }] },
    { point: [{ key: 'x', modifiers: ['Mod'] }], line: [{ key: 'x', modifiers: ['Meta'] }] },
    { point: [{ key: 'x' }, { key: 'x' }] },
  ]) expect(() => resolveKeyboardShortcuts(update as KeyboardShortcuts)).toThrow(/conflict/);
  // Swapping or freeing shortcuts in the same atomic update is allowed.
  expect(resolveKeyboardShortcuts({ cancel: [{ key: 'Enter' }], finish: [{ key: 'Escape' }] }).cancel).toEqual([{ key: 'Enter' }]);
  expect(resolveKeyboardShortcuts({ undo: false, point: [{ key: 'z', modifiers: ['Mod'] }] }).undo).toEqual([]);
});

it.each([
  null, [], true, { unknown: [] }, { point: undefined }, { point: 'p' }, { point: [null] },
  { point: [{ key: '' }] }, { point: [{ key: 'Tab' }] }, { point: [{ key: 'PageDown' }] },
  { point: [{ key: ' ' }] }, { point: [{ key: 'Dead' }] }, { point: [{ key: 'Control' }] },
  { point: [{ key: 'ArrowLeft' }] }, { point: [{ key: 'p', code: 'KeyP' }] },
  { point: [{ key: 'p', modifiers: 'Mod' }] }, { point: [{ key: 'p', modifiers: ['Super'] }] },
  { point: [{ key: 'p', modifiers: ['Shift', 'Shift'] }] }, { point: [{ key: 'p', modifiers: ['Mod', 'Meta'] }] },
])('rejects malformed shortcut configuration %#', update => {
  expect(() => resolveKeyboardShortcuts(update as unknown as KeyboardShortcuts)).toThrow(TypeError);
});

it('disables all commands and restores a saved complete table', () => {
  const saved = resolveKeyboardShortcuts({ polygon: [{ key: 'p' }] });
  const off = resolveKeyboardShortcuts(false, saved);
  expect(Object.values(off).every(bindings => bindings.length === 0)).toBe(true);
  expect(resolveKeyboardShortcuts(saved, off)).toEqual(saved);
});
