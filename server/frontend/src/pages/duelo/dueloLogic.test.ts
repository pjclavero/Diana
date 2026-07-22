import { describe, expect, it } from "vitest";
import { rankPlayers } from "./dueloLogic";

describe("rankPlayers (duelo)", () => {
  it("gana quien tiene más aciertos aunque sea más lento", () => {
    const r = rankPlayers([
      { name: "rápido", hits: 5, timeMs: 4000 },
      { name: "certero", hits: 9, timeMs: 9000 },
    ]);
    expect(r.winners).toEqual(["certero"]);
  });

  it("a igualdad de aciertos, gana el de menor tiempo", () => {
    const r = rankPlayers([
      { name: "lento", hits: 9, timeMs: 8000 },
      { name: "veloz", hits: 9, timeMs: 6000 },
    ]);
    expect(r.winners).toEqual(["veloz"]);
    expect(r.ranking.map((x) => x.name)).toEqual(["veloz", "lento"]);
  });

  it("empate exacto → dos ganadores en posición 1, el tercero en posición 3", () => {
    const r = rankPlayers([
      { name: "a", hits: 7, timeMs: 5000 },
      { name: "b", hits: 7, timeMs: 5000 },
      { name: "c", hits: 4, timeMs: 3000 },
    ]);
    expect(r.winners.sort()).toEqual(["a", "b"]);
    expect(r.ranking.find((x) => x.name === "c")!.position).toBe(3);
  });
});
