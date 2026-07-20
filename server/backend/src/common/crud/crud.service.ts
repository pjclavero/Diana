/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, NotFoundException } from '@nestjs/common';

/** Subconjunto de un delegado de Prisma que necesita el CRUD genérico. */
export interface PrismaDelegate {
  findMany(args?: any): Promise<any[]>;
  findUnique(args: any): Promise<any | null>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  delete(args: any): Promise<any>;
  count(args?: any): Promise<number>;
}

export interface ListQuery {
  skip?: number;
  take?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
  where?: Record<string, unknown>;
}

export interface Page<T> {
  items: T[];
  total: number;
  skip: number;
  take: number;
}

/**
 * CRUD genérico sobre un delegado de Prisma.
 *
 * Existe para no repetir veinte veces el mismo controlador de datos de
 * referencia. Las entidades con reglas de negocio propias (impactos, partidas,
 * munición) NO usan esto: tienen su propio servicio.
 */
export class CrudService<T = any> {
  constructor(
    protected readonly delegate: PrismaDelegate,
    protected readonly entity: string,
    /** Campos que el cliente puede escribir. Todo lo demás se descarta. */
    protected readonly writableFields: string[],
    protected readonly include?: Record<string, unknown>,
  ) {}

  protected pick(data: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const field of this.writableFields) {
      if (data[field] !== undefined) clean[field] = data[field];
    }
    if (Object.keys(clean).length === 0) {
      throw new BadRequestException(
        `Ningún campo escribible en la petición. Admitidos: ${this.writableFields.join(', ')}`,
      );
    }
    return clean;
  }

  async list(query: ListQuery = {}): Promise<Page<T>> {
    const take = Math.min(Math.max(query.take ?? 50, 1), 500);
    const skip = Math.max(query.skip ?? 0, 0);
    const orderBy = query.orderBy ? { [query.orderBy]: query.order ?? 'asc' } : undefined;

    const [items, total] = await Promise.all([
      this.delegate.findMany({ where: query.where, skip, take, orderBy, include: this.include }),
      this.delegate.count({ where: query.where }),
    ]);
    return { items, total, skip, take };
  }

  async get(id: string): Promise<T> {
    const found = await this.delegate.findUnique({ where: { id }, include: this.include });
    if (!found) throw new NotFoundException(`${this.entity} ${id} no encontrado`);
    return found;
  }

  async create(data: Record<string, unknown>): Promise<T> {
    return this.delegate.create({ data: this.pick(data), include: this.include });
  }

  async update(id: string, data: Record<string, unknown>): Promise<T> {
    await this.get(id);
    return this.delegate.update({ where: { id }, data: this.pick(data), include: this.include });
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    await this.get(id);
    await this.delegate.delete({ where: { id } });
    return { id, deleted: true };
  }
}
