import { describe, it, expect } from 'vitest';
import { isHttpsUrl } from './urls';

describe('isHttpsUrl', () => {
  it('accepts well-formed https URLs', () => {
    expect(isHttpsUrl('https://example.com/audio.ogg')).toBe(true);
    expect(isHttpsUrl('https://cdn.juke.audio/x/recap.mp4?token=abc#t=1,2')).toBe(true);
    expect(isHttpsUrl('  https://example.com/with-leading-space  ')).toBe(true);
  });

  it('rejects non-https schemes', () => {
    expect(isHttpsUrl('http://example.com/audio.ogg')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('data:audio/ogg;base64,AAAA')).toBe(false);
    expect(isHttpsUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpsUrl('ftp://example.com/x')).toBe(false);
  });

  it('rejects junk and non-strings', () => {
    expect(isHttpsUrl('')).toBe(false);
    expect(isHttpsUrl('not a url')).toBe(false);
    expect(isHttpsUrl('example.com')).toBe(false);
    expect(isHttpsUrl(42)).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
    expect(isHttpsUrl(undefined)).toBe(false);
  });
});
