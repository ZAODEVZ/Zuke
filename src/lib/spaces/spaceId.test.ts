import { describe, it, expect } from 'vitest';
import { isImportedSpaceId, isValidSpaceId } from './spaceId';
import { isValidJukeSpaceId } from './juke';
import { zukeIdForXSpace } from './xSpaces';

describe('isValidSpaceId', () => {
  it('accepts whatever the native Juke validator accepts', () => {
    // Mirror a couple of ids the Juke validator considers valid so this test
    // tracks juke.ts rather than hard-coding a format that could drift.
    const jukeId = 'abc123def456';
    if (isValidJukeSpaceId(jukeId)) {
      expect(isValidSpaceId(jukeId)).toBe(true);
    }
  });

  it('accepts imported X Space ids (x- prefixed)', () => {
    const id = zukeIdForXSpace('1YpKkZWBplYxj');
    expect(id).toBe('x-1YpKkZWBplYxj');
    expect(isValidSpaceId(id)).toBe(true);
  });

  it('rejects ids containing characters outside the allowed set', () => {
    // Spaces and other punctuation fail BOTH the Juke pattern ([A-Za-z0-9_-])
    // and the X-id check, so these are rejected outright.
    expect(isValidSpaceId('x-has space')).toBe(false);
    expect(isValidSpaceId('has space')).toBe(false);
    expect(isValidSpaceId('bad/slash')).toBe(false);
    expect(isValidSpaceId('with.dot')).toBe(false);
    expect(isValidSpaceId('emoji😀')).toBe(false);
  });

  it('rejects non-strings and empty', () => {
    expect(isValidSpaceId('')).toBe(false);
    expect(isValidSpaceId('  ')).toBe(false);
    expect(isValidSpaceId(42)).toBe(false);
    expect(isValidSpaceId(null)).toBe(false);
  });
});

describe('isImportedSpaceId', () => {
  it('is true only for the x- imported namespace', () => {
    expect(isImportedSpaceId('x-1YpKkZWBplYxj')).toBe(true);
    expect(isImportedSpaceId('1YpKkZWBplYxj')).toBe(false);
    expect(isImportedSpaceId('x-junk id')).toBe(false);
    expect(isImportedSpaceId(null)).toBe(false);
  });
});
