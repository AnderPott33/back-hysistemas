import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { pool } from '../db/db.js';

export type TipoAsiento = 'PAGO' | 'RECIBIMIENTO' | 'SAQUE' | 'DEPOSITO' | 'TRANSFERENCIA' | 'AJUSTE' | 'CREDITO';
export type Naturaleza = 'Débito' | 'Crédito';
export type FormaPago = 'Efectivo' | 'Lanzamiento Bancario' | 'Depósito Bancario' | 'Saque Bancario' | 'Cheque' | 'Tarjeta';

// Los asientos de caja siempre son Efectivo.
const FORMA_PAGO_CAJA: FormaPago = 'Efectivo';

// Los asientos de cuenta deben llegar con una de estas formas de pago desde el front.
const FORMAS_PAGO_CUENTA: readonly FormaPago[] = ['Lanzamiento Bancario', 'Cheque', 'Tarjeta', 'Depósito Bancario', 'Saque Bancario'];

// Tipos que exigen subcategoría. CREDITO nunca la lleva.
const TIPOS_CON_SUBCATEGORIA: readonly TipoAsiento[] = ['PAGO', 'RECIBIMIENTO'];

export type DatosAsiento = {
    movimientoId?: number | null;
    tipoAsiento: TipoAsiento;
    forma_pago?: FormaPago | null;
    /** Caja en uso del movimiento. Obligatoria en todos los asientos. */
    cajaMovimiento: number;
    cajaId?: number | null;
    cuentaId?: number | null;
    subcategoriaId?: number | null;
    naturaleza: Naturaleza;
    monedaId: number;
    valor: number;
    tipoCambioId?: number | null;
    cambio?: number | null;
    valorConvertido?: number | null;
    valorContable: number;
    personaId?: number | null;
    tituloId?: number | null;
    documentoId?: number | null;
    documento?: string | null;
    vencimiento?: string | null;
    historico?: string | null;
    fechaContable?: string | null;
    usuarioId: number;
};

export class ErrorValidacionAsiento extends Error { }

function resolverCajaMovimiento(d: DatosAsiento): number {
    return d.cajaMovimiento;
}

function resolverFormaPago(d: DatosAsiento): FormaPago {
    if (d.cajaId != null) return FORMA_PAGO_CAJA;

    if (!d.forma_pago || !FORMAS_PAGO_CUENTA.includes(d.forma_pago)) {
        throw new ErrorValidacionAsiento(
            `Un asiento de cuenta debe tener forma de pago: ${FORMAS_PAGO_CUENTA.join(', ')}`
        );
    }
    return d.forma_pago;
}

function validarAsiento(d: DatosAsiento): void {
    if ((d.cajaId != null) === (d.cuentaId != null)) {
        throw new ErrorValidacionAsiento('El asiento debe apuntar a una caja o a una cuenta, no a ambas ni a ninguna');
    }

    if (!Number.isInteger(d.cajaMovimiento) || d.cajaMovimiento <= 0) {
        throw new ErrorValidacionAsiento('Todo asiento debe indicar la caja en uso (caja_movimiento)');
    }

    resolverFormaPago(d);

    // Subcategoría: obligatoria en PAGO y RECIBIMIENTO, prohibida en el resto.
    const requiereSubcategoria = TIPOS_CON_SUBCATEGORIA.includes(d.tipoAsiento);
    const tieneSubcategoria = d.subcategoriaId != null;

    if (requiereSubcategoria && !tieneSubcategoria) {
        throw new ErrorValidacionAsiento(`El asiento de tipo ${d.tipoAsiento} requiere subcategoría`);
    }
    if (!requiereSubcategoria && tieneSubcategoria) {
        throw new ErrorValidacionAsiento(`El asiento de tipo ${d.tipoAsiento} no debe llevar subcategoría`);
    }

    // CREDITO no lleva cuenta ni subcategoría.
    if (d.tipoAsiento === 'CREDITO' && (d.cuentaId != null || tieneSubcategoria)) {
        throw new ErrorValidacionAsiento('Un asiento CREDITO no lleva cuenta ni subcategoría');
    }

    if (!(d.valor > 0)) {
        throw new ErrorValidacionAsiento('El valor debe ser mayor a cero');
    }

    if (!(d.valorContable > 0)) {
        throw new ErrorValidacionAsiento('El valor contable debe ser mayor a cero');
    }
}

async function insertarFilas(
    client: PoolClient,
    datos: DatosAsiento[],
    grupoId: string | null
): Promise<number[]> {
    const ids: number[] = [];

    for (const d of datos) {
        const formaPago = resolverFormaPago(d);
        const cajaMovimiento = resolverCajaMovimiento(d);

        const { rows } = await client.query(
            `INSERT INTO asiento (
    movimiento_id, tipo_asiento, forma_pago, caja_id, cuenta_id, subcategoria_id,
    naturaleza, moneda_id, valor, tipo_cambio_id, cambio, valor_convertido,
    valor_contable, persona_id, titulo_id, documento_id, documento, vencimiento,
    historico, fecha_contable, creado_por, caja_movimiento, grupo_id
 )
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
         $19, COALESCE($20::date, CURRENT_DATE), $21, $22, $23::uuid)
 RETURNING id`,
            [
                d.movimientoId ?? null,
                d.tipoAsiento,
                formaPago,
                d.cajaId ?? null,
                d.cuentaId ?? null,
                d.subcategoriaId ?? null,
                d.naturaleza,
                d.monedaId,
                d.valor,
                d.tipoCambioId ?? null,
                d.cambio ?? null,
                d.valorConvertido ?? null,
                d.valorContable,
                d.personaId ?? null,
                d.tituloId ?? null,
                d.documentoId ?? null,
                d.documento ?? null,
                d.vencimiento ?? null,
                d.historico ?? null,
                d.fechaContable ?? null,
                d.usuarioId,
                cajaMovimiento,
                grupoId,
            ]
        );
        ids.push(rows[0].id);
    }

    return ids;
}

/**
 * Inserta uno o varios asientos.
 * - Los asientos sin movimiento que llegan en el mismo lote forman un grupo (grupo_id)
 *   y se cancelan juntos (depósito, saque, transferencia).
 * - Sin `client`: abre su propia transacción y la confirma.
 * - Con `client`: participa en la transacción de quien llama (no hace BEGIN ni COMMIT).
 */
export async function insertarAsientos(datos: DatosAsiento[], client?: PoolClient): Promise<number[]> {
    datos.forEach(validarAsiento);

    const sinMovimiento = datos.every((d) => d.movimientoId == null);
    const grupoId = sinMovimiento ? randomUUID() : null;

    if (client) {
        return insertarFilas(client, datos, grupoId);
    }

    const propio = await pool.connect();
    try {
        await propio.query('BEGIN');
        const ids = await insertarFilas(propio, datos, grupoId);
        await propio.query('COMMIT');
        return ids;
    } catch (error) {
        await propio.query('ROLLBACK');
        throw error;
    } finally {
        propio.release();
    }
}

/** Atajo para insertar una sola fila. */
export async function insertarAsiento(dato: DatosAsiento, client?: PoolClient): Promise<number> {
    const [id] = await insertarAsientos([dato], client);
    return id;
}

/**
 * Cancela todos los asientos efectivados de un movimiento.
 * No borra filas: conserva la auditoría.
 */
export async function cancelarAsientosDeMovimiento(
    movimientoId: number,
    usuarioId: number,
    motivo: string,
    client?: PoolClient
): Promise<void> {
    const ejecutor = client ?? pool;
    await ejecutor.query(
        `UPDATE asiento
         SET estado = 'Cancelado',
             fecha_cancelacion = now(),
             motivo_cancelacion = $3,
             cancelado_por = $2
         WHERE movimiento_id = $1 AND estado = 'Efectivado'`,
        [movimientoId, usuarioId, motivo]
    );
}

/** Devuelve un asiento por id, con los demás asientos de su grupo. */
const SQL_ASIENTO_DETALLE = `
    SELECT
        a.*,
        c.nombre          AS cuenta_nombre,
        c.numero_cuenta   AS cuenta_numero,
        c.tipo            AS cuenta_tipo,
        c.banco_nombre    AS cuenta_banco,
        c.moneda_id       AS cuenta_moneda_id,
        cj.descripcion    AS caja_descripcion,

        uc.id             AS creado_por_id,
        uc.nombre         AS creado_por_nombre,
        uc.email          AS creado_por_email,

        ucan.id           AS cancelado_por_id,
        ucan.nombre       AS cancelado_por_nombre,
        ucan.email        AS cancelado_por_email
    FROM asiento a
    LEFT JOIN cuenta   c    ON c.id    = a.cuenta_id
    LEFT JOIN cajas    cj   ON cj.id   = a.caja_id
    LEFT JOIN usuarios uc   ON uc.id   = a.creado_por
    LEFT JOIN usuarios ucan ON ucan.id = a.cancelado_por
`;

/** Devuelve un asiento por id con datos de su cuenta, caja y usuarios, y los asientos de su grupo. */
export async function obtenerAsientoPorId(id: number): Promise<Record<string, unknown> | null> {
    const { rows } = await pool.query(`${SQL_ASIENTO_DETALLE} WHERE a.id = $1`, [id]);
    const asiento = rows[0];
    if (!asiento) return null;

    if (!asiento.grupo_id) {
        return { ...asiento, grupo: [asiento] };
    }

    const { rows: grupo } = await pool.query(
        `${SQL_ASIENTO_DETALLE} WHERE a.grupo_id = $1 ORDER BY a.id`,
        [asiento.grupo_id]
    );
    return { ...asiento, grupo };
}

/**
 * Cancela un asiento sin movimiento.
 * - Si tiene grupo_id, cancela todos los asientos efectivados del grupo (el par completo).
 * - Si no tiene grupo, cancela solo ese asiento (datos anteriores a grupo_id).
 * Devuelve la cantidad de asientos cancelados.
 */
export async function cancelarAsientoPorId(
    id: number,
    usuarioId: number,
    motivo: string
): Promise<number> {
    const motivoLimpio = motivo.trim();
    if (!motivoLimpio) {
        throw new ErrorValidacionAsiento('El motivo de cancelación es obligatorio');
    }

    const { rows } = await pool.query(
        `SELECT id, estado, movimiento_id, grupo_id FROM asiento WHERE id = $1`,
        [id]
    );
    const asiento = rows[0];

    if (!asiento) {
        throw new ErrorValidacionAsiento(`El asiento ${id} no existe`);
    }
    if (asiento.movimiento_id != null) {
        throw new ErrorValidacionAsiento(
            'El asiento pertenece a un movimiento. Cancelalo desde el movimiento'
        );
    }
    if (asiento.estado !== 'Efectivado') {
        throw new ErrorValidacionAsiento('El asiento ya está cancelado');
    }

    const cambios = asiento.grupo_id
        ? await pool.query(
            `UPDATE asiento
             SET estado = 'Cancelado',
                 fecha_cancelacion = now(),
                 motivo_cancelacion = $3,
                 cancelado_por = $2
             WHERE grupo_id = $1
               AND estado = 'Efectivado'
               AND movimiento_id IS NULL
             RETURNING id`,
            [asiento.grupo_id, usuarioId, motivoLimpio]
        )
        : await pool.query(
            `UPDATE asiento
             SET estado = 'Cancelado',
                 fecha_cancelacion = now(),
                 motivo_cancelacion = $3,
                 cancelado_por = $2
             WHERE id = $1
               AND estado = 'Efectivado'
               AND movimiento_id IS NULL
             RETURNING id`,
            [id, usuarioId, motivoLimpio]
        );

    return cambios.rowCount ?? 0;
}