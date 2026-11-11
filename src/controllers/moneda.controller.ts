import { Request, Response } from 'express';
import { query } from '../db/db.js';

// Convierte DD/MM/YYYY → YYYY-MM-DD para PostgreSQL
const toISO = (fecha: string | null | undefined): string | null => {
    if (!fecha) return null;
    const match = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    return fecha;
};

// ─── Validadores ───────────────────────────────────────────────────────────

const esNumero = (valor: unknown): valor is number => {
    if (typeof valor === 'number') return valor > 0;
    if (typeof valor === 'string') {
        const num = parseInt(valor, 10);
        return !isNaN(num) && num > 0;
    }
    return false;
};

const respuestaError = (res: Response, statusCode: number, mensaje: string) => {
    res.status(statusCode).json({ error: mensaje });
};

// ─── Helper para convertir a string ───────────────────────────────────────

const toString = (valor: unknown): string | null => {
    if (typeof valor === 'string') return valor;
    if (Array.isArray(valor)) return valor[0] ?? null;
    return null;
};

// ─── Moneda ───────────────────────────────────────────────────────────────────

export const ListarMonedas = async (req: Request, res: Response) => {
    try {
        const result = await query(`
            SELECT id, codigo, nombre, simbolo, decimales, activo, creado_en
            FROM moneda ORDER BY id
        `);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        respuestaError(res, 500, "No se encontraron monedas");
    }
};

export const ListarMonedasActivas = async (req: Request, res: Response) => {
    try {
        const result = await query(`
            SELECT id, codigo, nombre, simbolo, decimales, activo, creado_en
            FROM moneda WHERE activo::boolean = true::boolean ORDER BY id
        `);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        respuestaError(res, 500, "No se encontraron monedas");
    }
};

export const ListarMonedaId = async (req: Request, res: Response) => {
    const id = toString(req.params.id);

    if (!id || !esNumero(id)) {
        return respuestaError(res, 400, "El ID debe ser un número válido");
    }

    try {
        const result = await query(
            `SELECT id, codigo, nombre, simbolo, decimales, activo, creado_en FROM moneda WHERE id = $1`,
            [parseInt(id, 10)]
        );

        if (!result.rows[0]) {
            return respuestaError(res, 404, "Moneda no encontrada");
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        respuestaError(res, 500, "No se pudo obtener la moneda");
    }
};

export const ActualizarMoneda = async (req: Request, res: Response) => {
    const { id, codigo, nombre, simbolo, decimales, activo } = req.body;

    if (!codigo || !nombre || !simbolo || decimales === undefined) {
        return respuestaError(res, 400, "Faltan campos requeridos");
    }

    try {
        if (id) {
            if (!esNumero(id)) {
                return respuestaError(res, 400, "El ID debe ser un número válido");
            }

            await query(
                `UPDATE moneda SET codigo=$1, nombre=$2, simbolo=$3, decimales=$4, activo=$5 WHERE id=$6`,
                [codigo, nombre, simbolo, parseInt(decimales, 10), activo ?? true, parseInt(String(id), 10)]
            );
            res.status(200).json({ mensaje: 'Moneda actualizada correctamente' });
        } else {
            // Insertar nueva moneda
            const resultMoneda = await query(
                `INSERT INTO moneda (codigo, nombre, simbolo, decimales, activo) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
                [codigo, nombre, simbolo, parseInt(decimales, 10), activo ?? true]
            );

            const monedaId = resultMoneda.rows[0].id;


           
                await query(
                    `INSERT INTO cuentas ( nombre, tipo_cuenta, banco_nombre, numero_cuenta, moneda_id, activo)
                     VALUES ($1, $2, $3, $4, $5, TRUE)`,
                    [
                        
                        `Cofre ${codigo}`,
                        'COFRE',
                        'Caja Local',
                        `COFRE-${codigo}`,
                        monedaId
                    ]
                );
            

            res.status(201).json({
                mensaje: 'Moneda creada correctamente y cuentas Cofre generadas',
                moneda_id: monedaId
            });
        }
    } catch (error: any) {
        console.error(error);
        if (error.code === '23505') {
            respuestaError(res, 400, "El código o nombre de moneda ya existe");
        } else {
            respuestaError(res, 500, "No se pudo guardar la moneda");
        }
    }
};

// ─── Tipo de cambio ───────────────────────────────────────────────────────────

export const ListarTiposCambio = async (req: Request, res: Response) => {
    try {
        const result = await query(`
            SELECT
                tc.id,
                tc.grupo_id,
                tc.moneda_origen,
                mo.codigo  AS origen_codigo,
                mo.nombre  AS origen_nombre,
                mo.simbolo AS origen_simbolo,
                tc.moneda_destino,
                md.codigo  AS destino_codigo,
                md.nombre  AS destino_nombre,
                md.simbolo AS destino_simbolo,
                tc.valor,
                tc.fecha,
                tc.activo,
                tc.creado_en
            FROM tipo_cambio tc
            INNER JOIN moneda mo ON mo.id = tc.moneda_origen
            INNER JOIN moneda md ON md.id = tc.moneda_destino
            ORDER BY tc.fecha DESC, tc.id DESC
        `);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        respuestaError(res, 500, "No se encontraron tipos de cambio");
    }
};

export const ListarTipoCambioVigente = async (req: Request, res: Response) => {
    // ✅ Convertir query params correctamente
    const { datosTodos } = req.body;
    const { origen, destino, fecha } = datosTodos;
    /* const origen = String(req.query.origen).trim();
    const destino = String(req.query.destino).trim();
    const fecha = String(req.query.fecha).trim() || new Date().toISOString().slice(0, 10); */

    // ✅ Validar que sean números
    if (!origen || isNaN(Number(origen)) || !destino || isNaN(Number(destino))) {
        return respuestaError(res, 400, "Los IDs de moneda deben ser números válidos");
    }

    try {
        const result = await query(`
            SELECT tc.id, tc.valor, tc.fecha, 
                mo.codigo AS origen_codigo, mo.simbolo AS origen_simbolo,
                md.codigo AS destino_codigo, md.simbolo AS destino_simbolo
            FROM tipo_cambio tc
            INNER JOIN moneda mo ON mo.id = tc.moneda_origen
            INNER JOIN moneda md ON md.id = tc.moneda_destino
            WHERE tc.moneda_origen=$1 AND tc.moneda_destino=$2
              AND tc.fecha <= $3
              AND tc.activo = true
            ORDER BY tc.fecha DESC LIMIT 1
        `, [parseInt(origen, 10), parseInt(destino, 10), fecha]);

        // ✅ Manejo explícito de resultado vacío
        if (!result.rows || result.rows.length === 0) {
            return respuestaError(res, 404, "No se encontró tipo de cambio vigente para estas monedas en la fecha especificada");
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error("Error en ListarTipoCambioVigente:", error);
        respuestaError(res, 500, "Error al consultar tipo de cambio vigente");
    }
};

export const ListarTipoCambioId = async (req: Request, res: Response) => {
    const id = toString(req.params.id);

    if (!id || !esNumero(id)) {
        return respuestaError(res, 400, "El ID debe ser un número válido");
    }

    try {
        const result = await query(`
            SELECT tc.id, tc.grupo_id, tc.moneda_origen, tc.moneda_destino,
                tc.valor, tc.fecha, tc.activo, tc.creado_en,
                mo.codigo AS origen_codigo, mo.simbolo AS origen_simbolo,
                md.codigo AS destino_codigo, md.simbolo AS destino_simbolo
            FROM tipo_cambio tc
            INNER JOIN moneda mo ON mo.id = tc.moneda_origen
            INNER JOIN moneda md ON md.id = tc.moneda_destino
            WHERE tc.id = $1
        `, [parseInt(id, 10)]);

        if (!result.rows[0]) {
            return respuestaError(res, 404, "Tipo de cambio no encontrado");
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        respuestaError(res, 500, "No se pudo obtener el tipo de cambio");
    }
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toUuidOrNull = (valor: unknown): string | null =>
    typeof valor === 'string' && UUID_REGEX.test(valor) ? valor : null;

export const ActualizarTipoCambio = async (req: Request, res: Response) => {
    const { id, moneda_origen, moneda_destino, valor, fecha, activo, grupo_id } = req.body;

    if (!moneda_origen || !moneda_destino || !valor) {
        return respuestaError(res, 400, "Faltan campos requeridos");
    }

    if (!esNumero(moneda_origen) || !esNumero(moneda_destino)) {
        return respuestaError(res, 400, "Los IDs de moneda deben ser números válidos");
    }

    try {
        const desde = toISO(fecha);
        const grupo = toUuidOrNull(grupo_id);

        if (id) {
            if (!esNumero(id)) {
                return respuestaError(res, 400, "El ID debe ser un número válido");
            }

            // COALESCE conserva el grupo actual si el front no envía uno válido
            await query(`
                UPDATE tipo_cambio SET
                    moneda_origen = $1,
                    moneda_destino = $2,
                    valor = $3,
                    fecha = $4,
                    activo = $5,
                    grupo_id = COALESCE($6::uuid, grupo_id)
                WHERE id = $7
            `, [
                parseInt(String(moneda_origen), 10),
                parseInt(String(moneda_destino), 10),
                valor,
                desde,
                activo ?? true,
                grupo,
                parseInt(String(id), 10),
            ]);
        } else {
            // Si no llega grupo, la fila queda en un grupo propio
            await query(`
                INSERT INTO tipo_cambio (moneda_origen, moneda_destino, valor, fecha, activo, grupo_id)
                VALUES ($1, $2, $3, $4, $5, COALESCE($6::uuid, gen_random_uuid()))
            `, [
                parseInt(String(moneda_origen), 10),
                parseInt(String(moneda_destino), 10),
                valor,
                desde,
                activo ?? true,
                grupo,
            ]);
        }

        res.status(200).json({ mensaje: 'Cotización guardada correctamente' });
    } catch (error) {
        console.error(error);
        respuestaError(res, 500, "No se pudo guardar la cotización");
    }
};

export const HayTipoCambioHoy = async (req: Request, res: Response) => {
    try {
        const result = await query(
            `
            SELECT EXISTS (
                SELECT 1
                FROM tipo_cambio
                WHERE activo = true
                  AND fecha = (NOW() AT TIME ZONE 'America/Asuncion')::date
            ) AS hay_tipo_cambio_hoy
            `
        );

        return res.status(200).json({
            hay_tipo_cambio_hoy: result.rows[0].hay_tipo_cambio_hoy
        });
    } catch (error) {
        console.error("Error en HayTipoCambioHoy:", error);
        return respuestaError(res, 500, "Error al verificar tipo de cambio del día");
    }
};