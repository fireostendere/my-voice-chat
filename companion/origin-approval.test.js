import { describe, expect, it, vi } from 'vitest';
import { createOriginApprover, normalizeOrigin } from './origin-approval.js';

describe('origin approval', () => {
  it('normalizes HTTP origins and rejects unsafe values', () => {
    expect(normalizeOrigin('https://chat.example.com/room?a=1')).toBe('https://chat.example.com');
    expect(normalizeOrigin('ws://chat.example.com')).toBeUndefined();
    expect(normalizeOrigin('https://user:secret@chat.example.com')).toBeUndefined();
  });

  it('treats an explicit allowlist as authoritative', async () => {
    const prompt = vi.fn();
    const approver = createOriginApprover({
      configuredOrigins: ['https://chat.example.com'],
      load: vi.fn(async () => ['https://other.example.com']),
      save: vi.fn(),
      prompt,
    });

    await expect(approver.isAllowed('https://chat.example.com/room')).resolves.toBe(true);
    await expect(approver.isAllowed('https://other.example.com')).resolves.toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('allows loopback origins without prompting', async () => {
    const prompt = vi.fn();
    const approver = createOriginApprover({
      load: vi.fn(async () => []),
      save: vi.fn(),
      prompt,
    });

    await expect(approver.isAllowed('http://127.0.0.1:3000')).resolves.toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('prompts once, persists approval, and reuses it', async () => {
    const prompt = vi.fn(async () => true);
    const save = vi.fn(async () => {});
    const approver = createOriginApprover({
      load: vi.fn(async () => []),
      save,
      prompt,
    });

    const attempts = await Promise.all([
      approver.isAllowed('https://chat.example.com'),
      approver.isAllowed('https://chat.example.com'),
    ]);
    await expect(approver.isAllowed('https://chat.example.com')).resolves.toBe(true);

    expect(attempts).toEqual([true, true]);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(['https://chat.example.com']);
  });

  it('does not persist a rejected origin', async () => {
    const save = vi.fn();
    const approver = createOriginApprover({
      load: vi.fn(async () => []),
      save,
      prompt: vi.fn(async () => false),
    });

    await expect(approver.isAllowed('https://evil.example.com')).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('lets the local control panel add and remove a trusted site without a prompt', async () => {
    const save = vi.fn(async () => {});
    const prompt = vi.fn();
    const approver = createOriginApprover({
      load: vi.fn(async () => []),
      save,
      prompt,
    });

    await expect(approver.allow('https://api.iroslyakov.com/rooms/cinema')).resolves.toBe(
      'https://api.iroslyakov.com',
    );
    await expect(approver.listAllowed()).resolves.toEqual(['https://api.iroslyakov.com']);
    await expect(approver.isAllowed('https://api.iroslyakov.com')).resolves.toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    expect(save).toHaveBeenLastCalledWith(['https://api.iroslyakov.com']);

    await expect(approver.revoke('https://api.iroslyakov.com')).resolves.toBe(
      'https://api.iroslyakov.com',
    );
    await expect(approver.listAllowed()).resolves.toEqual([]);
    expect(save).toHaveBeenLastCalledWith([]);
  });

  it('does not let the local control panel override a managed allowlist', async () => {
    const approver = createOriginApprover({
      configuredOrigins: ['https://chat.example.com'],
      load: vi.fn(async () => []),
      save: vi.fn(),
      prompt: vi.fn(),
    });

    expect(approver.managed).toBe(true);
    await expect(approver.listAllowed()).resolves.toEqual(['https://chat.example.com']);
    await expect(approver.allow('https://other.example.com')).rejects.toThrow('COMPANION_ORIGINS');
    await expect(approver.revoke('https://chat.example.com')).rejects.toThrow('COMPANION_ORIGINS');
  });
});
