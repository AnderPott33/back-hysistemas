import { Request, Response } from 'express';
import { query } from '../db/db.js';

interface RequestWithUser extends Request {
    user?: {
        id: number;
    }
}

export const agregarActualizarAlmacen = async (req: Request, res: Response) => {
    const {
        id,
        codigo,
        nombre,
        descripcion,
        activo
    } = req.body;

    const consultaINSERT = `
        INSERT INTO almacen (
        descripcion,
        codigo,
        nombre,
        activo
        )
        VALUES ($1, $2, $3, $4)
        `;
    const consultaUPDATE = `
    UPDATE almacen SET
        descripcion = $1,
        codigo = $2,
        nombre = $3,
        activo = $4
        WHERE id = $5
    `;

    try {
        if (id) {
            const result = await query(consultaUPDATE, [,
                descripcion,
                codigo,
                nombre,
                activo,
                id
            ])

            if (result) {
                res.status(204).json({ message: 'Almacén actualizado exitosamente' })
            } else {
                res.status(500).json({ message: 'No se pudo actualizar el amacén' })
            }

        } else {
            const result = await query(consultaINSERT, [,
                descripcion,
                codigo,
                nombre,
                activo
            ])

            if (result) {
                res.status(201).json({ message: 'Almacén agregado exitosamente' })
            } else {
                res.status(500).json({ message: 'No se pudo crear el amacén' })
            }
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
}

export const cargarAlmacenes = async (req: Request, res: Response) => {
    try {
        const consultaSQL =
            `
            SELECT * FROM almacen
            `;
        const result = await query(consultaSQL);
        res.status(200).json(result.rows)
    } catch (error) {
        console.error(error);
    }
}

export const cargarAlmacenId = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const consultaSQL =
            `
            SELECT * FROM almacen
            where id = $1
            `;
        const result = await query(consultaSQL, [id]);
        res.status(200).json(result.rows[0])
    } catch (error) {
        console.error(error);
    }
}