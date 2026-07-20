import { expect, test } from "@playwright/test";

/**
 * Comprueba que la navegación se adapta a ordenador, tableta y móvil.
 * Los proyectos "tablet" y "mobile" en playwright.config.ts usan viewports
 * reales de dispositivo; aquí forzamos también anchos explícitos para no
 * depender sólo del proyecto activo.
 */
const VIEWPORTS = [
  { name: "escritorio", width: 1280, height: 800, sidebarVisible: true },
  { name: "tableta", width: 800, height: 1024, sidebarVisible: false },
  { name: "móvil", width: 390, height: 844, sidebarVisible: false },
];

for (const vp of VIEWPORTS) {
  test(`navegación en ${vp.name} (${vp.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Inicio" })).toBeVisible();

    const menuBtn = page.getByRole("button", { name: /menú/i });
    if (vp.sidebarVisible) {
      await expect(menuBtn).toBeHidden();
      await expect(page.getByRole("link", { name: "Inicio" })).toBeVisible();
    } else {
      await expect(menuBtn).toBeVisible();
      // La navegación empieza oculta y se abre con el botón de menú.
      await expect(page.getByRole("link", { name: "Editor de matriz" })).toBeHidden();
      await menuBtn.click();
      await expect(page.getByRole("link", { name: "Editor de matriz" })).toBeVisible();
    }

    // El contenido nunca debe producir scroll horizontal de página.
    const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasHorizontalScroll).toBe(false);
  });
}
