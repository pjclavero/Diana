import { expect, test } from "@playwright/test";

/**
 * Flujo E2E completo contra el adaptador MOCK: configurar matriz 3x3,
 * crear partida, ver impactos llegar en directo, terminar, ver resultados
 * y estadísticas. No requiere backend (WP-02) ni Docker.
 */
test.describe("Flujo completo de partida (mock)", () => {
  test("editor de topología: rotar módulo y detectar duplicados", async ({ page }) => {
    await page.goto("/topologia");
    await expect(page.getByRole("heading", { name: "Editor de matriz de módulos" })).toBeVisible();

    const chip = page.locator(".topology-chip").filter({ hasText: "module-01" });
    await expect(chip).toBeVisible();
    await expect(chip.getByText("Rotación: 0°")).toBeVisible();

    // module-01 está bloqueado en los datos de ejemplo: el botón de rotar está deshabilitado.
    await expect(chip.getByRole("button", { name: /rotar module-01/i })).toBeDisabled();

    // Un módulo no bloqueado sí puede rotar.
    const chip02 = page.locator(".topology-chip").filter({ hasText: "module-02" });
    await chip02.getByRole("button", { name: /rotar module-02/i }).click();
    await expect(chip02.getByText("Rotación: 180°")).toBeVisible();
  });

  test("crear partida, ver el directo con impactos y llegar a resultados", async ({ page }) => {
    await page.goto("/partidas/nueva");
    await expect(page.getByRole("heading", { name: "Crear partida" })).toBeVisible();

    // Aplica un preset con dianas ya seleccionadas.
    await page.getByLabel("Preset").selectOption({ label: "9 dianas aleatorias" });

    // Selecciona jugadores.
    await page.getByRole("checkbox", { name: "Ana García" }).check();
    await page.getByRole("checkbox", { name: "Luis Pérez" }).check();

    await page.getByRole("button", { name: /crear e ir a cuenta atrás/i }).click();

    // Cuenta atrás → directo automáticamente.
    await expect(page).toHaveURL(/\/cuenta-atras$/);
    await expect(page).toHaveURL(/\/directo$/, { timeout: 10_000 });

    await expect(page.getByRole("heading", { name: "Partida en directo" })).toBeVisible();

    // Debe verse la conexión y, en unos segundos, al menos un impacto en la lista.
    // El indicador de conexión es el ConnectionBadge (data-testid inequívoco): el
    // regex genérico también casaba con el <h1> "Partida en directo" y violaba strict mode.
    await expect(page.getByTestId("connection-badge")).toHaveText(/en directo|conectando/i);
    await expect(page.locator("text=Últimos impactos").locator("..")).toBeVisible();

    // Espera a que llegue al menos un evento de impacto (el motor mock genera uno cada ~1.4s).
    await expect(page.locator("ul li", { hasText: "module-01" }).first()).toBeVisible({ timeout: 15_000 });

    // Espera a que la partida finalice (9 dianas del preset, ~13s) y navega a resultados.
    await expect(page.getByText("Partida finalizada")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: "Ver resultados completos" }).click();

    await expect(page.getByRole("heading", { name: "Resultados" })).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
  });

  test("estadísticas muestra el agregado por jugador, incluido el caso no calculable", async ({ page }) => {
    await page.goto("/estadisticas");
    await expect(page.getByRole("heading", { name: "Estadísticas" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    // El resultado de ejemplo p2 no tiene munición restante conocida.
    await expect(page.getByText(/precisión no calculable/i)).toBeVisible();
  });
});
