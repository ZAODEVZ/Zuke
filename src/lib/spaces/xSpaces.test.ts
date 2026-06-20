import { describe, it, expect } from 'vitest';
import { isValidXSpaceId, parseXSpaceUrl, zukeIdForXSpace } from './xSpaces';

describe('isValidXSpaceId', () => {
  it('accepts base62-ish space ids', () => {
    expect(isValidXSpaceId('1YpKkZWBplYxj')).toBe(true);
    expect(isValidXSpaceId('1dRJZEpyjlNGB')).toBe(true);
  });
  it('rejects junk', () => {
    expect(isValidXSpaceId('')).toBe(false);
    expect(isValidXSpaceId('has space')).toBe(false);
    expect(isValidXSpaceId('with-hyphen')).toBe(false);
    expect(isValidXSpaceId(42)).toBe(false);
    expect(isValidXSpaceId(null)).toBe(false);
  });
});

describe('zukeIdForXSpace', () => {
  it('namespaces with an x- prefix', () => {
    expect(zukeIdForXSpace('1YpKkZWBplYxj')).toBe('x-1YpKkZWBplYxj');
  });
});

describe('parseXSpaceUrl', () => {
  it('parses an x.com /i/spaces/ link', () => {
    const out = parseXSpaceUrl('https://x.com/i/spaces/1YpKkZWBplYxj');
    expect(out).toEqual({
      xSpaceId: '1YpKkZWBplYxj',
      zukeId: 'x-1YpKkZWBplYxj',
      url: 'https://x.com/i/spaces/1YpKkZWBplYxj',
    });
  });

  it('parses a twitter.com link and a /spaces/ (no /i/) path', () => {
    expect(parseXSpaceUrl('https://twitter.com/i/spaces/1dRJZEpyjlNGB')?.xSpaceId).toBe(
      '1dRJZEpyjlNGB',
    );
    expect(parseXSpaceUrl('https://x.com/spaces/1dRJZEpyjlNGB')?.xSpaceId).toBe('1dRJZEpyjlNGB');
  });

  it('tolerates a missing protocol and trailing query', () => {
    expect(parseXSpaceUrl('x.com/i/spaces/1YpKkZWBplYxj?utm=1')?.zukeId).toBe('x-1YpKkZWBplYxj');
  });

  it('accepts a bare space id and canonicalizes the url', () => {
    const out = parseXSpaceUrl('1YpKkZWBplYxj');
    expect(out?.url).toBe('https://x.com/i/spaces/1YpKkZWBplYxj');
  });

  it('rejects non-X hosts and non-space paths', () => {
    expect(parseXSpaceUrl('https://juke.audio/space/abc')).toBeNull();
    expect(parseXSpaceUrl('https://x.com/someuser/status/123')).toBeNull();
    expect(parseXSpaceUrl('https://x.com/i/spaces/')).toBeNull();
    expect(parseXSpaceUrl('')).toBeNull();
    expect(parseXSpaceUrl('not a url')).toBeNull();
  });
});
