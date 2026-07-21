import { beforeEach, describe, expect, it } from "vitest";
import { getToken, setToken } from "./tokenStore";

describe("tokenStore", () => {
  beforeEach(() => {
    setToken(null);
    localStorage.clear();
  });

  it("guarda y recupera el token", () => {
    setToken("abc.def.ghi");
    expect(getToken()).toBe("abc.def.ghi");
    expect(localStorage.getItem("diana.auth.token")).toBe("abc.def.ghi");
  });

  it("al poner null borra el token de memoria y de localStorage", () => {
    setToken("tok");
    setToken(null);
    expect(getToken()).toBeNull();
    expect(localStorage.getItem("diana.auth.token")).toBeNull();
  });
});
