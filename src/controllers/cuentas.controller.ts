import { Request, Response } from 'express';
import { query } from '../db/db.js';

const TIPOS_CUENTA = ['Efectivo', 'Banco'];

// Consulta base: cuenta + moneda + saldo actual calculado por la vista
const SELECT_CUENTA = `
    SELECT
        c.id,
        c.nombre,
        c.tipo,
        c.banco_nombre,
        c.numero_cuenta,
        c.saldo_inicial,
       c.permite_lanzamiento_tarjeta,
        c.activo,
        c.creado_en,
        c.actualizado_en,
        json_build_object(
            'id', m.id,
            'codigo', m.codigo,
            'nombre', m.nombre,
            'simbolo', m.simbolo,
            'decimales', m.decimales
        ) AS moneda
    FROM cuenta c
    LEFT JOIN moneda m ON m.id = c.moneda_id

`;

export const ListarCuentas = async (req: Request, res: Response) => {
    try {
        const result = await query(`${SELECT_CUENTA} ORDER BY c.tipo ASC, c.nombre ASC`);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json("No se encontraron cuentas");
    }
}

export const ListarCuentaId = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await query(`${SELECT_CUENTA} WHERE c.id = $1`, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Cuenta no encontrada" });
        }
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json("No se encontró la cuenta");
    }
}

export const ListarCuentasPorTipo = async (req: Request, res: Response) => {
    const tipo = String(req.params.tipo);

    if (!TIPOS_CUENTA.includes(tipo)) {
        return res.status(400).json({ error: `tipo debe ser uno de: ${TIPOS_CUENTA.join(', ')}` });
    }

    try {
        const result = await query(
            `${SELECT_CUENTA} WHERE c.tipo = $1 ORDER BY c.nombre ASC`,
            [tipo]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json("No se encontraron cuentas");
    }
}

export const ActualizarCuenta = async (req: Request, res: Response) => {
    const {
        id,
        nombre,
        tipo,
        moneda_id,
        banco_nombre,
        numero_cuenta,
        saldo_inicial,
        permite_lanzamiento_tarjeta,
        activo,
    } = req.body;

    if (!nombre || !tipo || !moneda_id) {
        return res.status(400).json({ error: "Faltan campos requeridos (nombre, tipo, moneda_id)" });
    }

    if (!TIPOS_CUENTA.includes(tipo)) {
        return res.status(400).json({ error: `tipo debe ser uno de: ${TIPOS_CUENTA.join(', ')}` });
    }

    const saldoInicialFinal = Number(saldo_inicial ?? 0);
    if (Number.isNaN(saldoInicialFinal)) {
        return res.status(400).json({ error: "saldo_inicial debe ser un número" });
    }

    try {
        if (id) {
            const actual = await query(
                'SELECT moneda_id FROM cuenta WHERE id = $1',
                [id]
            );

            if (actual.rows.length === 0) {
                return res.status(404).json({ error: "Cuenta no encontrada" });
            }

            // Cambiar la moneda de una cuenta con movimientos alteraría el significado de sus montos.
            if (actual.rows[0].moneda_id !== moneda_id) {
                const movs = await query(
                    'SELECT COUNT(*)::int AS total FROM bajas WHERE cuenta_id = $1',
                    [id]
                );
                if (movs.rows[0].total > 0) {
                    return res.status(409).json({
                        error: "No se puede cambiar la moneda de una cuenta que ya tiene movimientos"
                    });
                }
            }

            const result = await query(`
                UPDATE cuenta SET
                    nombre = $1,
                    tipo = $2,
                    moneda_id = $3,
                    banco_nombre = $4,
                    numero_cuenta = $5,
                    saldo_inicial = $6,
                    activo = $7,
                    permite_lanzamiento_tarjeta = $9,
                    actualizado_en = NOW()
                WHERE id = $8
                RETURNING *
            `, [
                nombre,
                tipo,
                moneda_id,
                banco_nombre ?? null,
                numero_cuenta ?? null,
                saldoInicialFinal,
                activo ?? true,
                id,
                permite_lanzamiento_tarjeta,
            ]);

            return res.status(200).json({
                message: 'Cuenta actualizada correctamente',
                data: result.rows[0]
            });
        }

        const result = await query(`
            INSERT INTO cuenta (nombre, tipo, moneda_id, banco_nombre, numero_cuenta, saldo_inicial, activo, permite_lanzamiento_tarjeta,)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            nombre,
            tipo,
            moneda_id,
            banco_nombre ?? null,
            numero_cuenta ?? null,
            saldoInicialFinal,
            activo ?? true,
            permite_lanzamiento_tarjeta,
        ]);

        res.status(200).json({
            message: 'Cuenta creada correctamente',
            data: result.rows[0]
        });
    } catch (error: any) {
        console.error(error);

        // 23503 = moneda_id no existe
        if (error?.code === '23503') {
            return res.status(400).json({ error: "La moneda indicada no existe" });
        }

        res.status(500).json("No se pudo actualizar/crear la cuenta");
    }
}