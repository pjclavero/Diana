import { describe, expect, it } from 'vitest';
import { classifyHit } from '../src/domain/classify.js';

describe('classifyHit (dosier §17.1)', () => {
  it('diana activa, sin orden estricto -> valid_hit', () => {
    const r = classifyHit({ moduleState: 'game_active', targetState: 'active', outOfExpectedOrder: false });
    expect(r.classification).toBe('valid_hit');
  });

  it('diana en azul (safe) -> hit_on_safe', () => {
    const r = classifyHit({ moduleState: 'game_active', targetState: 'safe', outOfExpectedOrder: false });
    expect(r.classification).toBe('hit_on_safe');
  });

  it('diana ya alcanzada (hit) -> hit_on_already_hit', () => {
    const r = classifyHit({ moduleState: 'game_active', targetState: 'hit', outOfExpectedOrder: false });
    expect(r.classification).toBe('hit_on_already_hit');
  });

  it('diana activa pero fuera del orden estricto -> out_of_order', () => {
    const r = classifyHit({ moduleState: 'game_active', targetState: 'active', outOfExpectedOrder: true });
    expect(r.classification).toBe('out_of_order');
  });

  it('diana en cuenta atrás (aún no activa) -> early_shot', () => {
    const r = classifyHit({ moduleState: 'game_active', targetState: 'countdown', outOfExpectedOrder: false });
    expect(r.classification).toBe('early_shot');
  });

  it('módulo en calibración -> calibration_hit, prioritario sobre el estado de la diana', () => {
    const r = classifyHit({ moduleState: 'calibration', targetState: 'active', outOfExpectedOrder: false });
    expect(r.classification).toBe('calibration_hit');
  });

  it('partida en pausa -> during_pause, prioritario sobre el estado de la diana', () => {
    const r = classifyHit({ moduleState: 'game_paused', targetState: 'active', outOfExpectedOrder: false });
    expect(r.classification).toBe('during_pause');
  });

  it('cualquier clasificación distinta de valid_hit trae un motivo legible', () => {
    const r = classifyHit({ moduleState: 'game_active', targetState: 'safe', outOfExpectedOrder: false });
    expect(r.reason).toBeTruthy();
  });
});
