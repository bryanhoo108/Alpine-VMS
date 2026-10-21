import { expect, type Page } from '@playwright/test';

export const PIN = process.env.E2E_PIN ?? '2468';

export async function reset(page: Page) {
  const res = await page.request.post('/__e2e/reset');
  expect(res.ok()).toBe(true);
}

/** Sign in as a guard or checker by tapping the name and the PIN pad. */
export async function signInWithPin(page: Page, displayName: string) {
  await page.goto('/');
  await page.getByRole('button', { name: displayName }).click();
  for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
}

/** The camera at a gate reads a plate (mock LPR). */
export async function cameraSees(page: Page, plate: string, camera: 'entry' | 'exit' = 'entry') {
  const res = await page.request.post('/api/dev/lpr', { data: { camera, plate } });
  expect(res.ok()).toBe(true);
}

/**
 * Guard screen rules from CLAUDE.md: no page scroll, and every visible button
 * is a real touch target.
 */
export async function expectGuardLayout(page: Page) {
  const m = await page.evaluate(() => {
    const el = document.scrollingElement!;
    const small = [...document.querySelectorAll('button')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden';
        // The small purple "Test" button is a mock-only developer tool.
        return (
          visible && !b.matches('[aria-label="Test tools"]') && (r.height < 44 || r.width < 44)
        );
      })
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    // Clipped by overflow:hidden but still off the screen: as bad as scrolling.
    const offscreen = [...document.querySelectorAll('button, [role="alert"]')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return (
          r.width > 0 && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1)
        );
      })
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    return {
      offscreen,
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      small,
    };
  });
  expect(m.scrollH, 'page scrolls vertically').toBeLessThanOrEqual(m.clientH);
  expect(m.scrollW, 'page scrolls sideways').toBeLessThanOrEqual(m.clientW);
  expect(m.small, 'buttons smaller than 44px').toEqual([]);
  expect(m.offscreen, 'buttons or alerts off the screen').toEqual([]);
}
