import { describe, it, expect } from 'vitest';
import { readRecordingParts } from './recordingParts';

describe('readRecordingParts', () => {
  it('reads a single legacy recording_url as one part', () => {
    const parts = readRecordingParts({ recording_url: 'https://cdn.juke.audio/a.ogg' });
    expect(parts).toEqual([
      { url: 'https://cdn.juke.audio/a.ogg', title: null, durationSeconds: null },
    ]);
  });

  it('reads a nested data.url single part', () => {
    const parts = readRecordingParts({ data: { url: 'https://cdn.juke.audio/b.ogg' } });
    expect(parts).toHaveLength(1);
    expect(parts[0].url).toBe('https://cdn.juke.audio/b.ogg');
  });

  it('reads a multi-part data.parts array preserving order', () => {
    const parts = readRecordingParts({
      data: {
        parts: [
          { url: 'https://cdn.juke.audio/p1.ogg', title: 'Intro', duration: 90 },
          { recording_url: 'https://cdn.juke.audio/p2.ogg', duration_seconds: '120.4' },
        ],
      },
    });
    expect(parts).toEqual([
      { url: 'https://cdn.juke.audio/p1.ogg', title: 'Intro', durationSeconds: 90 },
      { url: 'https://cdn.juke.audio/p2.ogg', title: null, durationSeconds: 120 },
    ]);
  });

  it('accepts a data.recordings array of bare url strings', () => {
    const parts = readRecordingParts({
      data: { recordings: ['https://cdn.juke.audio/x.ogg', 'https://cdn.juke.audio/y.ogg'] },
    });
    expect(parts.map((p) => p.url)).toEqual([
      'https://cdn.juke.audio/x.ogg',
      'https://cdn.juke.audio/y.ogg',
    ]);
  });

  it('skips array entries with no usable url', () => {
    const parts = readRecordingParts({
      data: { parts: [{ title: 'no url here' }, { url: 'https://cdn.juke.audio/ok.ogg' }] },
    });
    expect(parts).toHaveLength(1);
    expect(parts[0].url).toBe('https://cdn.juke.audio/ok.ogg');
  });

  it('returns an empty array when there is no recording at all', () => {
    expect(readRecordingParts({ data: {} })).toEqual([]);
    expect(readRecordingParts(null)).toEqual([]);
    expect(readRecordingParts({ data: { parts: [] } })).toEqual([]);
  });

  it('ignores negative or non-numeric durations', () => {
    const parts = readRecordingParts({
      data: { parts: [{ url: 'https://cdn.juke.audio/z.ogg', duration: -5 }] },
    });
    expect(parts[0].durationSeconds).toBeNull();
  });
});
