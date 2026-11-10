import { Request, Response } from 'express';
import { query } from '../db/db.js';

interface RequestWithUser extends Request {
    user?: {
        id: number;
    }
}

export const agregarActualizarTimbrado = async (req: Request, res: Response) => {
    const {
        id,
        timbrado,
        tipo_nota,
        autorizacion,
        fecha_inicio,
        fecha_fin,
        punto_expedicion,
        sucursal,
        proximo_numero,
        numero_maximo
    } = req.body;

    const consultaINSERT = `
        INSERT INTO timbrado (
        timbrado,
        tipo_nota,
        autorizacion,
        fecha_inicio,
        fecha_fin,
        punto_expedicion,
        sucursal,
        proximo_numero,
        numero_maximo
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
    const consultaUPDATE = `
    UPDATE timbrado SET
        timbrado = $1,
        tipo_nota = $2,
        autorizacion = $3,
        fecha_inicio = $4,
        fecha_fin = $5,
        punto_expedicion = $6,
        sucursal = $7,
        proximo_numero = $8,
        numero_maximo = $9
        WHERE id = $10
    `;

    try {
        if (id) {
            const result = await query(consultaUPDATE, [,
                timbrado,
                tipo_nota,
                autorizacion,
                fecha_inicio,
                fecha_fin,
                punto_expedicion,
                sucursal,
                proximo_numero,
                numero_maximo,
                id
            ])

            if (result) {
                res.status(204).json({ message: 'Timbrado actualizado exitosamente' })
            } else {
                res.status(500).json({ message: 'No se pudo actualizar el Timbrado' })
            }

        } else {
            const result = await query(consultaINSERT, [,
                timbrado,
                tipo_nota,
                autorizacion,
                fecha_inicio,
                fecha_fin,
                punto_expedicion,
                sucursal,
                proximo_numero,
                numero_maximo
            ])

            if (result) {
                res.status(201).json({ message: 'Timbrado agregado exitosamente' })
            } else {
                res.status(500).json({ message: 'No se pudo crear el Timbrado' })
            }
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
}

export const cargarTimbrados = async (req: Request, res: Response) => {
    try {
        const consultaSQL =
            `
            SELECT * FROM timbrado
            `;
        const result = await query(consultaSQL);
        res.status(200).json(result.rows)
    } catch (error) {
        console.error(error);
    }
}

export const cargarTimbradoId = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const consultaSQL =
            `
            SELECT * FROM timbrado
            where id = $1
            `;
        const result = await query(consultaSQL, [id]);
        res.status(200).json(result.rows[0])
    } catch (error) {
        console.error(error);
    }
}

export const generarProximoNumero = async (req: Request, res: Response) => {
    const { timbrado, sucursal, punto_expedicion, tipo_transaccion, tipo_nota, proximo_numero, numero_maximo } = req.body;
    const dataActual = new Date();

    try {
        const consultaTimbrado = await query(
            `SELECT * FROM timbrado 
             WHERE timbrado = $1 AND sucursal = $2 AND punto_expedicion = $3 AND tipo_nota = $4 AND tipo_transaccion = $5`,
            [timbrado, sucursal, punto_expedicion, tipo_nota, tipo_transaccion]
        );

        if (!consultaTimbrado.rows || consultaTimbrado.rows.length === 0) {
            return res.status(404).json({ message: 'Timbrado no encontrado' });
        }

        const fechaFin = new Date(consultaTimbrado.rows[0].fecha_fin);
        fechaFin.setHours(23, 59, 59, 999);

        const estadoTimbrado = fechaFin >= dataActual ? 'vigente' : 'vencido';

        // Calcular nuevo número
        const nuevoNumero = estadoTimbrado === 'vigente' &&
            Number(consultaTimbrado.rows[0].proximo_numero) === Number(proximo_numero)
            ? Number(consultaTimbrado.rows[0].proximo_numero) + 1
            : Number(consultaTimbrado.rows[0].proximo_numero);

        // CORREGIDO: Verificar si el nuevo número NO excede el máximo
        const numeracionDisponible = nuevoNumero <= Number(consultaTimbrado.rows[0].numero_maximo);

        if (!numeracionDisponible) {
            return res.status(200).json({
                message: 'Numeración máxima del timbrado alcanzada',
                estadoTimbrado,
                nuevoNumero,
                fechaFin,
                dataActual
            });
        }

        if (estadoTimbrado === 'vigente') {
            // CORREGIDO: Array de parámetros con solo 6 elementos para 6 placeholders
            const consultaActualizarSec = `
                UPDATE timbrado 
                SET proximo_numero = $6
                WHERE timbrado = $1 
                AND sucursal = $2 
                AND punto_expedicion = $3 
                AND tipo_nota = $4 
                AND tipo_transaccion = $5
            `;

            await query(
                consultaActualizarSec,
                [timbrado, sucursal, punto_expedicion, tipo_nota, tipo_transaccion, nuevoNumero]
                //  $1      $2         $3                   $4         $5                $6
            );

            return res.status(200).json({
                message: 'Secuencia actualizada',
                estadoTimbrado,
                nuevoNumero,
                fechaFin,
                dataActual,
                numeracionDisponible
            });
        } else {
            return res.status(200).json({
                message: 'Timbrado vencido, no se pudo actualizar secuencia',
                estadoTimbrado,
                nuevoNumero,
                fechaFin,
                dataActual
            });
        }

    } catch (error) {
        console.error('Error en generarProximoNumero:', error);
        return res.status(500).json({ message: 'Error interno del servidor!' });
    }
};

// timbrado.service.ts
export const obtenerProximoNumero = async (
    timbrado: number,
    sucursal: number,
    punto_expedicion: number,
    tipo_transaccion: string,
    tipo_nota: string,
    proximo_numero: number,
    numero_maximo: number
) => {
    const dataActual = new Date();

    try {
        const consultaTimbrado = await query(
            `SELECT * FROM timbrado 
             WHERE timbrado = $1 AND sucursal = $2 AND punto_expedicion = $3 AND tipo_nota = $4 AND tipo_transaccion = $5`,
            [timbrado, sucursal, punto_expedicion, tipo_nota, tipo_transaccion]
        );

        if (!consultaTimbrado.rows || consultaTimbrado.rows.length === 0) {
            return { message: 'Timbrado no encontrado' };
        }

        const fechaFin = new Date(consultaTimbrado.rows[0].fecha_fin);
        fechaFin.setHours(23, 59, 59, 999);

        const estadoTimbrado = fechaFin >= dataActual ? 'vigente' : 'vencido';

        // Calcular nuevo número
        const nuevoNumero = estadoTimbrado === 'vigente' &&
            Number(consultaTimbrado.rows[0].proximo_numero) === Number(proximo_numero)
            ? Number(consultaTimbrado.rows[0].proximo_numero) + 1
            : Number(consultaTimbrado.rows[0].proximo_numero);

        // CORREGIDO: Verificar si el nuevo número NO excede el máximo
        const numeracionDisponible = nuevoNumero <= Number(consultaTimbrado.rows[0].numero_maximo);

        if (!numeracionDisponible) {
            return {
                message: 'Numeración máxima del timbrado alcanzada',
                type: 'error',
                estadoTimbrado,
                nuevoNumero,
                fechaFin,
                dataActual,
                proximo_numero
            };
        }

        if (estadoTimbrado === 'vigente') {
            // CORREGIDO: Array de parámetros con solo 6 elementos para 6 placeholders
            const consultaActualizarSec = `
                UPDATE timbrado 
                SET proximo_numero = $6
                WHERE timbrado = $1 
                AND sucursal = $2 
                AND punto_expedicion = $3 
                AND tipo_nota = $4 
                AND tipo_transaccion = $5
            `;

            await query(
                consultaActualizarSec,
                [timbrado, sucursal, punto_expedicion, tipo_nota, tipo_transaccion, nuevoNumero]
                //  $1      $2         $3                   $4         $5                $6
            );

            return {
                message: 'Secuencia actualizada',
                type: 'success',
                estadoTimbrado,
                nuevoNumero,
                fechaFin,
                dataActual,
                numeracionDisponible
            };
        } else {
            return {
                message: 'Timbrado vencido, no se pudo actualizar secuencia',
                type: 'error',
                estadoTimbrado,
                nuevoNumero,
                fechaFin,
                dataActual
            };
        }

    } catch (error) {
        console.error('Error en generarProximoNumero:', error);
        return { message: 'Error interno del servidor!' };
    }
};