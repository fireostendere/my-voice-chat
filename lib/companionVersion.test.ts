import { describe, expect, it } from 'vitest';
import { compareCompanionVersions, shouldOfferCompanionUpdate } from './companionVersion';

describe('companion version checks', () => {
  it('offers an update only when the site version is newer', () => {
    expect(shouldOfferCompanionUpdate('0.8.0', '0.7.0')).toBe(true);
    expect(shouldOfferCompanionUpdate('0.8.0', '0.8.0')).toBe(false);
    expect(shouldOfferCompanionUpdate('0.8.0', '0.9.0')).toBe(false);
  });

  it('follows semver prerelease ordering and ignores build metadata', () => {
    expect(compareCompanionVersions('0.8.0', '0.8.0-beta.10')).toBe(1);
    expect(compareCompanionVersions('0.8.0-beta.10', '0.8.0-beta.2')).toBe(1);
    expect(compareCompanionVersions('0.8.0+site.2', '0.8.0+desktop.1')).toBe(0);
  });

  it('offers an update to legacy clients that do not report a version', () => {
    expect(shouldOfferCompanionUpdate('0.8.0')).toBe(true);
    expect(shouldOfferCompanionUpdate('0.8.0', 'not-a-version')).toBe(true);
  });

  it('does not offer an update when the site version is invalid', () => {
    expect(shouldOfferCompanionUpdate('latest', '0.7.0')).toBe(false);
    expect(compareCompanionVersions('0.8.0', '0.8.0.0')).toBeNull();
  });
});
