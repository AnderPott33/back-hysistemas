import { Request, Response } from 'express';
import { query } from '../db/db.js';

interface RequestWithUser extends Request {
    user?: {
        id: number;
    }
}

export const agregarActualizarOperacion = async (req: Request, res: Response) => {
    const {
        id,
        descripcion,
        modulo,
        tipo_operacion,
        naturaleza_financiera,
        genera_documento_legal,
        timbrado,
        exige_persona,
        exige_categoria,
        exige_articulos,
        exige_almacen,
        genera_movimiento_stock,
        tipo_movimiento_stock,
        genera_movimiento_financiero_categoria,
        genera_movimiento_financiero_cuenta,
        activo,
        categoria_id,
        tipo_cuenta,
        almacen_id } = req.body;

    const consultaINSERT = `
        INSERT INTO operaciones_baja (
        descripcion,
        modulo,
        tipo_operacion,
        naturaleza_financiera,
        genera_documento_legal,
        timbrado,
        exige_persona,
        exige_categoria,
        exige_articulos,
        exige_almacen,
        genera_movimiento_stock,
        tipo_movimiento_stock,
        genera_movimiento_financiero_categoria,
        genera_movimiento_financiero_cuenta,
        activo,
        categoria_id,
        almacen_id,
        tipo_cuenta)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        `;
    const consultaUPDATE = `
    UPDATE operaciones_baja SET
        descripcion = $1,
        modulo = $2,
        tipo_operacion = $3,
        naturaleza_financiera = $4,
        genera_documento_legal = $5,
        timbrado = $6,
        exige_persona = $7,
        exige_categoria = $8,
        exige_articulos = $9,
        exige_almacen = $10,
        genera_movimiento_stock = $11,
        tipo_movimiento_stock = $12,
        genera_movimiento_financiero_categoria = $13,
        genera_movimiento_financiero_cuenta = $14,
        activo = $15,
        categoria_id = $16,
        almacen_id = $17,
        tipo_cuenta = $18
        WHERE id = $19
    `;

    try {
        if (id) {
            const result = await query(consultaUPDATE, [descripcion,
                modulo,
                tipo_operacion,
                naturaleza_financiera,
                genera_documento_legal,
                timbrado,
                exige_persona,
                exige_categoria,
                exige_articulos,
                exige_almacen,
                genera_movimiento_stock,
                tipo_movimiento_stock,
                genera_movimiento_financiero_categoria,
                genera_movimiento_financiero_cuenta,
                activo,
                categoria_id,
                almacen_id,
                tipo_cuenta,
                id])

            if (result) {
                res.status(204).json({ message: 'Operación actualizada exitosamente' })
            } else {
                res.status(500).json({ message: 'No se pudo actualizar la operación' })
            }

        } else {
            const result = await query(consultaINSERT, [descripcion,
                modulo,
                tipo_operacion,
                naturaleza_financiera,
                genera_documento_legal,
                timbrado,
                exige_persona,
                exige_categoria,
                exige_articulos,
                exige_almacen,
                genera_movimiento_stock,
                tipo_movimiento_stock,
                genera_movimiento_financiero_categoria,
                genera_movimiento_financiero_cuenta,
                activo,
                categoria_id,
                almacen_id,
                tipo_cuenta])

            if (result) {
                res.status(201).json({ message: 'Operación agregada exitosamente' })
            } else {
                res.status(500).json({ message: 'No se pudo actualizar la operación' })
            }
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
}

export const cargarOperaciones = async (req: Request, res: Response) => {
    try {
        const consultaSQL =
            `
            SELECT * FROM operaciones_baja
            `;
        const result = await query(consultaSQL);
        res.status(200).json(result.rows)
    } catch (error) {
        console.error(error);
    }
}

export const cargarOperacionId = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const consultaSQL =
            `
            SELECT * FROM operaciones_baja
            where id = $1
            `;
        const result = await query(consultaSQL, [id]);
        res.status(200).json(result.rows[0])
    } catch (error) {
        console.error(error);
    }
}