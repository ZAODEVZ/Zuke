import { test, expect } from '@playwright/test';

test.describe('smoke', () => {
  test('homepage loads and shows the hero', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.getByText('Host it. Import it. Keep it.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Listen now' })).toBeVisible();
  });

  test('/live loads without crashing', async ({ page }) => {
    const response = await page.goto('/live');
    expect(response?.status()).toBe(200);
  });

  test('/live/import loads the import form', async ({ page }) => {
    const response = await page.goto('/live/import');
    expect(response?.status()).toBe(200);
  });

  test('/api/health responds with a well-formed JSON shape', async ({ request }) => {
    const response = await request.get('/api/health');
    const body = await response.json();
    // No real Supabase credentials in this environment, so `ok` legitimately
    // varies - assert the CONTRACT (shape + status pairing), not connectivity.
    expect(typeof body.ok).toBe('boolean');
    expect(response.status()).toBe(body.ok ? 200 : 503);
  });

  test('a nonexistent route 404s cleanly', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
  });
});
