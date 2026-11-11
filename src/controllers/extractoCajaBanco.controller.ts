import { Request, Response } from 'express';
import { query } from '../db/db.js';

// Nombre de la columna de asiento que identifica la forma de pago (texto).
// Es una constante interna, no viene del request.
const COLUMNA_FORMA_PAGO = 'forma_pago';

const ENTIDADES = ['Caja', 'Cuenta'];
const REGEX_FECHA = /^(\d{4}-\d{2}-\d{2})/;

const esVacio = (valor: unknown) => valor === undefined || valor === null || valor === '';

const aEntero = (valor: unknown): number | null | undefined => {
    if (esVacio(valor)) return null;
    const n = Number(valor);
    if (!Number.isInteger(n)) return undefined;
    return n > 0 ? n : null;
};

const aFecha = (valor: unknown): string | null | undefined => {
    if (esVacio(valor)) return null;
    if (typeof valor !== 'string') return undefined;
    const match = valor.match(REGEX_FECHA);
    if (!match) return undefined;
    return isNaN(Date.parse(match[1])) ? undefined : match[1];
};

const aBooleano = (valor: unknown): boolean | undefined => {
    if (esVacio(valor)) return true;
    if (typeof valor === 'boolean') return valor;
    if (valor === 'true') return true;
    if (valor === 'false') return false;
    return undefined;
};

export const extractoCajaBanco = async (req: Request, res: Response) => {
    const { entidad, caja_id, cuenta_id, moneda_id, fecha_inicio, fecha_fin, consolidado } = req.body ?? {};

    const cajaId = aEntero(caja_id);
    const cuentaId = aEntero(cuenta_id);
    const monedaId = aEntero(moneda_id);
    const fechaInicio = aFecha(fecha_inicio);
    const fechaFin = aFecha(fecha_fin);
    const entidadFiltro = esVacio(entidad) ? null : entidad;
    const incluirAnterior = aBooleano(consolidado);

    if (cajaId === undefined || cuentaId === undefined || monedaId === undefined) {
        return res.status(400).json({ error: 'caja_id, cuenta_id y moneda_id deben ser enteros o null' });
    }
    if (fechaInicio === undefined || fechaFin === undefined) {
        return res.status(400).json({ error: 'fecha_inicio y fecha_fin deben tener formato YYYY-MM-DD o ser null' });
    }
    if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
        return res.status(400).json({ error: 'fecha_inicio no puede ser mayor a fecha_fin' });
    }
    if (entidadFiltro !== null && !ENTIDADES.includes(entidadFiltro)) {
        return res.status(400).json({ error: `entidad debe ser uno de: ${ENTIDADES.join(', ')} o null` });
    }
    if (incluirAnterior === undefined) {
        return res.status(400).json({ error: 'consolidado debe ser boolean o null' });
    }

    // Desde el día inicial a las 00:00:00 y hasta el día final a las 23:59:59.999999
    const desde = fechaInicio ? `${fechaInicio} 00:00:00` : null;
    const hasta = fechaFin ? `${fechaFin} 23:59:59.999999` : null;

    // Bloque común de movimientos del extracto: filtra por caja_id / cuenta_id.
    // La fecha de referencia del extracto es fecha_contable (no emision).
    const baseSQL = `
    WITH base AS (
        SELECT
            a.*,
            CASE WHEN a.caja_id IS NULL THEN COALESCE(a.valor_convertido, a.valor) ELSE a.valor END AS importe,
            CASE WHEN a.caja_id IS NULL THEN c.moneda_id       ELSE a.moneda_id END AS moneda_efectiva
        FROM public.asiento a
        LEFT JOIN public.cuenta c ON c.id = a.cuenta_id
        WHERE a.estado = 'Efectivado'
          AND (a.caja_id IS NOT NULL OR a.cuenta_id IS NOT NULL)
          AND ($4::text IS NULL
               OR ($4::text = 'Caja'   AND a.caja_id   IS NOT NULL)
               OR ($4::text = 'Cuenta' AND a.cuenta_id IS NOT NULL))
          AND (a.caja_id   IS NULL OR $1::int IS NULL OR a.caja_id   = $1::int)
          AND (a.cuenta_id IS NULL OR $2::int IS NULL OR a.cuenta_id = $2::int)
    ),
    unidos AS (
        SELECT
            CASE WHEN b.caja_id IS NOT NULL THEN 'Caja' ELSE 'Cuenta' END::text AS entidad,
            COALESCE(b.caja_id, b.cuenta_id)                AS entidad_id,
            b.moneda_efectiva                               AS moneda_id,
            b.movimiento_id                                 AS movimiento_id,
            b.id                                            AS detalle_id,
            b.fecha_contable                                AS fecha,
            b.emision                                       AS emision,
            COALESCE(m.observacion, '')                     AS descripcion,
            COALESCE(b.historico, '')                       AS descripcion_baja,
            COALESCE(b.${COLUMNA_FORMA_PAGO}::text, 'Sin forma de pago') AS forma_pago,
            b.creado_por                                    AS creado_por,
            uc.nombre                                       AS creado_por_nombre,
            uc.email                                        AS creado_por_email,
            CASE WHEN b.naturaleza = 'Débito'  THEN b.importe ELSE NULL END AS entrada,
            CASE WHEN b.naturaleza = 'Crédito' THEN b.importe ELSE NULL END AS salida,
            CASE WHEN b.naturaleza = 'Débito'
                 THEN b.importe ELSE -b.importe END          AS neto
        FROM base b
        LEFT JOIN public.movimientos m ON m.id = b.movimiento_id
        LEFT JOIN public.usuarios uc   ON uc.id = b.creado_por
        WHERE ($3::int IS NULL OR b.moneda_efectiva = $3::int)
    )`;

    // Saldo anterior: una fila por cada entidad/moneda que cumple los filtros, aunque su saldo sea 0.
    // Usa $1..$5.
    const sqlSaldosAnteriores = `${baseSQL},
    previo AS (
        SELECT entidad, entidad_id, moneda_id,
               COALESCE(SUM(neto), 0) AS saldo_previo
        FROM unidos
        WHERE $5::timestamp IS NOT NULL
          AND fecha < $5::timestamp
        GROUP BY entidad, entidad_id, moneda_id
    ),
    claves AS (
        SELECT DISTINCT entidad, entidad_id, moneda_id
        FROM unidos
    )
    SELECT
        k.entidad,
        k.entidad_id,
        k.moneda_id,
        COALESCE(pr.saldo_previo, 0) AS saldo_anterior
    FROM claves k
    LEFT JOIN previo pr
      ON pr.entidad = k.entidad
     AND pr.entidad_id = k.entidad_id
     AND pr.moneda_id = k.moneda_id
    ORDER BY k.entidad, k.entidad_id, k.moneda_id`;

    // Movimientos del periodo, filtrados y ordenados por fecha_contable.
    // El saldo parte del saldo anterior solo si consolidado = true. Usa $1..$7.
    const sqlMovimientos = `${baseSQL},
    previo AS (
        SELECT entidad, entidad_id, moneda_id,
               COALESCE(SUM(neto), 0) AS saldo_previo
        FROM unidos
        WHERE $5::timestamp IS NOT NULL
          AND fecha < $5::timestamp
        GROUP BY entidad, entidad_id, moneda_id
    ),
    periodo AS (
        SELECT *
        FROM unidos
        WHERE ($5::timestamp IS NULL OR fecha >= $5::timestamp)
          AND ($6::timestamp IS NULL OR fecha <= $6::timestamp)
    )
    SELECT
        p.entidad,
        p.entidad_id,
        p.moneda_id,
        p.movimiento_id,
        TO_CHAR(p.fecha, 'YYYY-MM-DD') AS fecha,
        p.emision,
        p.detalle_id,
        p.detalle_id AS asiento_id,
        p.descripcion,
        p.descripcion_baja,
        p.forma_pago,
        p.creado_por,
        p.creado_por_nombre,
        p.creado_por_email,
        p.entrada,
        p.salida,
        (CASE WHEN $7::boolean THEN COALESCE(pr.saldo_previo, 0) ELSE 0 END)
          + SUM(p.neto) OVER (
              PARTITION BY p.entidad, p.entidad_id, p.moneda_id
              ORDER BY p.fecha, p.detalle_id
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS saldo
    FROM periodo p
    LEFT JOIN previo pr
      ON pr.entidad = p.entidad
     AND pr.entidad_id = p.entidad_id
     AND pr.moneda_id = p.moneda_id
    ORDER BY p.entidad, p.entidad_id, p.moneda_id, p.fecha, p.detalle_id`;

    // Totales por forma de pago, por fecha_contable.
    // - Con caja_id: incluye TODAS las formas de pago que tienen esa caja en caja_movimiento,
    //   aunque el asiento afecte una cuenta (lanzamiento, cheque, tarjeta).
    // - Con cuenta_id: se limita a esa cuenta.
    // - No aplica el filtro "entidad", porque excluiría los asientos de cuenta.
    // - Separa "Cheque" en "Cheque disponible" (sin vencimiento o vencido) y "Cheque pre datado".
    // Usa $1..$6: $1 caja, $2 cuenta, $3 moneda, $4 desde, $5 hasta, $6 consolidado.
    const sqlTotalesFormaPago = `
    WITH base AS (
        SELECT
            a.*,
            CASE WHEN a.caja_id IS NULL THEN COALESCE(a.valor_convertido, a.valor) ELSE a.valor END AS importe,
            CASE WHEN a.caja_id IS NULL THEN c.moneda_id       ELSE a.moneda_id END AS moneda_efectiva
        FROM public.asiento a
        LEFT JOIN public.cuenta c ON c.id = a.cuenta_id
        WHERE a.estado = 'Efectivado'
          AND ($1::int IS NULL OR a.caja_movimiento = $1::int)
          AND ($2::int IS NULL OR a.cuenta_id = $2::int)
    ),
    fp AS (
        SELECT
            CASE
                WHEN b.${COLUMNA_FORMA_PAGO} = 'Cheque' THEN
                    CASE WHEN b.vencimiento IS NULL OR b.vencimiento::date <= CURRENT_DATE
                         THEN 'Cheque disponible'
                         ELSE 'Cheque pre datado'
                    END
                ELSE COALESCE(b.${COLUMNA_FORMA_PAGO}::text, 'Sin forma de pago')
            END AS forma_pago,
            b.fecha_contable AS fecha_contable,
            CASE WHEN b.naturaleza = 'Débito'  THEN b.importe ELSE NULL END AS entrada,
            CASE WHEN b.naturaleza = 'Crédito' THEN b.importe ELSE NULL END AS salida,
            CASE WHEN b.naturaleza = 'Débito'
                 THEN b.importe ELSE -b.importe END          AS neto
        FROM base b
        WHERE ($3::int IS NULL OR b.moneda_efectiva = $3::int)
    ),
    previo AS (
        SELECT forma_pago,
               COALESCE(SUM(neto), 0) AS saldo_previo
        FROM fp
        WHERE $4::timestamp IS NOT NULL
          AND fecha_contable < $4::timestamp
        GROUP BY forma_pago
    ),
    periodo AS (
        SELECT *
        FROM fp
        WHERE ($4::timestamp IS NULL OR fecha_contable >= $4::timestamp)
          AND ($5::timestamp IS NULL OR fecha_contable <= $5::timestamp)
    ),
    por_periodo AS (
        SELECT forma_pago,
               COALESCE(SUM(entrada), 0) AS total_entrada,
               COALESCE(SUM(salida), 0)  AS total_salida,
               COALESCE(SUM(neto), 0)    AS neto_periodo
        FROM periodo
        GROUP BY forma_pago
    ),
    claves AS (
        SELECT DISTINCT forma_pago
        FROM fp
    )
    SELECT
        k.forma_pago,
        COALESCE(pr.saldo_previo, 0)  AS saldo_anterior,
        COALESCE(pp.total_entrada, 0) AS total_entrada,
        COALESCE(pp.total_salida, 0)  AS total_salida,
        (CASE WHEN $6::boolean THEN COALESCE(pr.saldo_previo, 0) ELSE 0 END)
          + COALESCE(pp.neto_periodo, 0) AS saldo_final
    FROM claves k
    LEFT JOIN previo pr      ON pr.forma_pago = k.forma_pago
    LEFT JOIN por_periodo pp ON pp.forma_pago = k.forma_pago
    ORDER BY k.forma_pago`;

    try {
        const [saldosResult, movimientosResult, totalesResult] = await Promise.all([
            query(sqlSaldosAnteriores, [cajaId, cuentaId, monedaId, entidadFiltro, desde]),
            query(sqlMovimientos, [cajaId, cuentaId, monedaId, entidadFiltro, desde, hasta, incluirAnterior]),
            query(sqlTotalesFormaPago, [cajaId, cuentaId, monedaId, desde, hasta, incluirAnterior]),
        ]);

        res.status(200).json({
            saldos_anteriores: saldosResult.rows,
            movimientos: movimientosResult.rows,
            totales_forma_pago: totalesResult.rows,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json('No se pudo generar el extracto');
    }
};

// ---------- SALDO DE UNA CUENTA ----------

// Saldo actual de la cuenta: suma débitos, resta créditos, solo asientos efectivados.
// Usa el mismo importe que el extracto (COALESCE(valor_convertido, valor)).
const SQL_SALDO_CUENTA = `
    SELECT
        COALESCE(SUM(
            CASE WHEN a.naturaleza = 'Débito'
                 THEN COALESCE(a.valor_convertido, a.valor)
                 ELSE -COALESCE(a.valor_convertido, a.valor)
            END
        ), 0) AS saldo
    FROM public.asiento a
    WHERE a.estado = 'Efectivado'
      AND a.cuenta_id = $1::int
`;

export const saldoCuenta = async (req: Request, res: Response) => {
    const cuentaId = Number(req.params.id);

    if (!Number.isInteger(cuentaId) || cuentaId <= 0) {
        return res.status(400).json({ error: 'El id de la cuenta debe ser un entero positivo' });
    }

    try {
        const result = await query(SQL_SALDO_CUENTA, [cuentaId]);
        const saldo = Number(result.rows[0]?.saldo ?? 0);

        return res.status(200).json({
            cuenta_id: cuentaId,
            saldo,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'No se pudo obtener el saldo de la cuenta' });
    }
};