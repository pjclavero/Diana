/**
 * Serialización CSV (RFC 4180) sin dependencias.
 *
 * Reglas: separador `,`, comillas dobles duplicadas, salto `\r\n`, BOM UTF-8
 * opcional para que Excel no destroce los acentos. `null` se escribe como
 * celda vacía, NUNCA como 0: la diferencia entre "cero" y "desconocido" es
 * justamente lo que exige ADR-0006.
 */

export type CsvValue = string | number | bigint | boolean | Date | null | undefined;

export function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'bigint'
        ? value.toString()
        : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(
  columns: string[],
  rows: Array<Record<string, CsvValue>>,
  options: { bom?: boolean } = {},
): string {
  const lines = [columns.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(row[column])).join(','));
  }
  return (options.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}
