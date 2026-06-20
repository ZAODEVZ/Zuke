import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchProfilesByFids } from './neynar';

describe('fetchProfilesByFids', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an empty map without calling fetch when the api key is missing', async () => {
    const map = await fetchProfilesByFids([1, 2], '');
    expect(map.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns an empty map for no fids', async () => {
    const map = await fetchProfilesByFids([], 'key');
    expect(map.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps bulk users by fid', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        users: [
          { fid: 3, username: 'alice', display_name: 'Alice', pfp_url: 'https://img/a.png' },
          { fid: 5, username: 'bob' },
        ],
      }),
    });
    const map = await fetchProfilesByFids([3, 5], 'key');
    expect(map.get(3)).toEqual({
      fid: 3,
      username: 'alice',
      display_name: 'Alice',
      pfp_url: 'https://img/a.png',
    });
    expect(map.get(5)).toEqual({ fid: 5, username: 'bob', display_name: null, pfp_url: null });
  });

  it('dedupes and drops non-positive fids before the request', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ users: [] }) });
    await fetchProfilesByFids([7, 7, 0, -1], 'key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('fids=7');
    expect(url).not.toContain('-1');
  });

  it('returns an empty map when fetch rejects', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    const map = await fetchProfilesByFids([9], 'key');
    expect(map.size).toBe(0);
  });

  it('chunks requests at 100 fids', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ users: [] }) });
    const fids = Array.from({ length: 150 }, (_, i) => i + 1);
    await fetchProfilesByFids(fids, 'key');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
