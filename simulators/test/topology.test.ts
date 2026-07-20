import { describe, expect, it } from 'vitest';
import { neighboursOf } from '../src/domain/topology.js';

describe('topology (adyacencia 3x3, dosier §6.2)', () => {
  it('la diana central (5) tiene 8 vecinos', () => {
    expect(neighboursOf(5).sort()).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  });

  it('una esquina (1) tiene 3 vecinos', () => {
    expect(neighboursOf(1).sort()).toEqual([2, 4, 5]);
  });

  it('un borde (2) tiene 5 vecinos', () => {
    expect(neighboursOf(2).sort()).toEqual([1, 3, 4, 5, 6]);
  });

  it('rechaza índices fuera de 1..9', () => {
    expect(() => neighboursOf(0)).toThrow();
    expect(() => neighboursOf(10)).toThrow();
  });
});
