import { describe, expect, it, vi } from 'vitest';
import { PttKeyListener, createLineParser, normalizePttKey } from './ptt-key-listener.js';

describe('normalizePttKey', () => {
  it('normalizes supported keys and aliases', () => {
    expect(normalizePttKey('f8')).toBe('F8');
    expect(normalizePttKey('mouse4')).toBe('XBUTTON1');
    expect(normalizePttKey('ctrl')).toBe('CONTROL');
  });

  it('rejects arbitrary key names', () => {
    expect(() => normalizePttKey('ANY KEY')).toThrow('Unsupported PTT key');
  });
});

describe('createLineParser', () => {
  it('handles split chunks and ignores line casing', () => {
    const onLine = vi.fn();
    const parse = createLineParser(onLine);
    parse('DO');
    parse('WN\r\nup\n');

    expect(onLine.mock.calls).toEqual([['DOWN'], ['UP']]);
  });
});

describe('PttKeyListener', () => {
  it('restarts the helper when the configured key changes', () => {
    const listener = new PttKeyListener({ key: 'F8', onState: vi.fn() });
    const kill = vi.fn();
    listener.child = { kill };
    listener.start = vi.fn();

    expect(listener.setKey('f9')).toBe('F9');
    expect(kill).toHaveBeenCalledOnce();
    expect(listener.start).toHaveBeenCalledOnce();
  });
});
