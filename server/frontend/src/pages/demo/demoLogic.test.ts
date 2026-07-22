import { describe, expect, it, beforeEach } from "vitest";
import { formatTime, loadTimes, makeSequence, pushTime, saveTimes } from "./demoLogic";

describe("demoLogic", () => {
  it("makeSequence: longitud pedida, índices 1..9, sin repetir la anterior", () => {
    const seq = makeSequence(20, () => 0.5); // rand fijo → tendería a repetir
    expect(seq).toHaveLength(20);
    for (const n of seq) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(9);
    }
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });

  it("pushTime: antepone y conserva sólo los 10 más recientes", () => {
    let times: number[] = [];
    for (let i = 1; i <= 12; i++) times = pushTime(times, i);
    expect(times).toHaveLength(10);
    expect(times[0]).toBe(12); // el más nuevo primero
    expect(times).not.toContain(1);
    expect(times).not.toContain(2);
  });

  it("formatTime: milisegundos a segundos con 2 decimales", () => {
    expect(formatTime(8420)).toBe("8.42 s");
  });

  describe("persistencia de sesión", () => {
    beforeEach(() => sessionStorage.clear());

    it("guarda y lee los tiempos de la sesión", () => {
      saveTimes([1000, 2000]);
      expect(loadTimes()).toEqual([1000, 2000]);
    });

    it("loadTimes tolera ausencia y JSON inválido", () => {
      expect(loadTimes()).toEqual([]);
      sessionStorage.setItem("diana.demo.times", "no-json");
      expect(loadTimes()).toEqual([]);
    });
  });
});
