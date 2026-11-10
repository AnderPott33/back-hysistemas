import { Request, Response } from 'express';
import { query } from '../db/db.js';

interface RequestWithUser extends Request {
    user?: {
        id: number;
    }
}

export const buscarCajas = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await query(`
            SELECT
                c.id,
                c.apertura,
                c.cierre,
                c.estado,
                c.descripcion,
                c.creado_en,
                c.usuario_id,
                u.nombre as usuario
            FROM cajas c
            LEFT JOIN usuarios u ON u.id = c.usuario_id
            ORDER BY c.creado_en DESC
        `);
        res.status(200).json(result.rows  || []);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al obtener cajas" });
    }
};

export const buscarCajaId = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const result = await query(`
            SELECT
                c.id,
                c.apertura,
                c.cierre,
                c.estado,
                c.descripcion,
                c.creado_en,
                c.usuario_id,
                u.nombre as usuario
            FROM cajas c
            LEFT JOIN usuarios u ON u.id = c.usuario_id
            WHERE c.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            res.status(404).json({ error: "Caja no encontrada" });
            return;
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al obtener caja" });
    }
};

export const crearCaja = async (req: Request, res: Response): Promise<void> => {
    const usuarioId = (req as RequestWithUser).user?.id;
    const { apertura, estado, descripcion } = req.body;

    try {
        if (!apertura) {
            res.status(400).json({ error: "apertura es requerido" });
            return;
        }

        const result = await query(
            `INSERT INTO cajas (apertura, estado, descripcion, usuario_id, creado_en)
             VALUES ($1, $2, $3, $4, NOW())
             RETURNING id, apertura, cierre, estado, descripcion, creado_en, usuario_id`,
            [apertura, estado || 'Abierta', descripcion || '', usuarioId]
        );

        const nuevaCaja = result.rows[0];

        await query(
            `UPDATE usuarios
             SET caja_logueada = $1
             WHERE id = $2`,
            [nuevaCaja.id, usuarioId]
        );

        res.status(201).json(nuevaCaja);
    } catch (error) {
        console.error('Error en crearCaja:', error);
        res.status(500).json({ error: "Error al crear caja", details: (error as Error).message });
    }
};

export const actualizarCaja = async (req: Request, res: Response): Promise<void> => {
    const { id, apertura, estado, descripcion } = req.body;

    try {
        if (!id) {
            res.status(400).json({ error: "id es requerido" });
            return;
        }

        if (apertura === null || apertura === undefined) {
            res.status(400).json({ error: "apertura es requerido" });
            return;
        }

        const validEstados = ['Abierta', 'Cerrada'];
        if (estado && !validEstados.includes(estado)) {
            res.status(400).json({ error: `estado debe ser uno de: ${validEstados.join(', ')}` });
            return;
        }

        const result = await query(
            `UPDATE cajas
             SET apertura = $1, estado = $2, descripcion = $3
             WHERE id = $4
             RETURNING id, apertura, cierre, estado, descripcion, creado_en, usuario_id`,
            [apertura, estado || 'Abierta', descripcion || '', id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: "Caja no encontrada" });
            return;
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error en actualizarCaja:', error);
        res.status(500).json({ error: "Error al actualizar caja", details: (error as Error).message });
    }
};

export const cerrarCaja = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
        if (!id) {
            res.status(400).json({ error: "id es requerido" });
            return;
        }

        const result = await query(
            `UPDATE cajas
             SET estado = 'Cerrada', cierre = NOW()
             WHERE id = $1
             RETURNING id, apertura, cierre, estado, descripcion, creado_en, usuario_id`,
            [id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: "Caja no encontrada" });
            return;
        }

        await query(
            `UPDATE usuarios
             SET caja_logueada = NULL
             WHERE caja_logueada = $1`,
            [id]
        );

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error en cerrarCaja:', error);
        res.status(500).json({ error: "Error al cerrar caja", details: (error as Error).message });
    }
};

export const reabrirCaja = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
        if (!id) {
            res.status(400).json({ error: "id es requerido" });
            return;
        }

        const result = await query(
            `UPDATE cajas
             SET estado = 'Abierta', cierre = NULL
             WHERE id = $1
             RETURNING id, apertura, cierre, estado, descripcion, creado_en, usuario_id`,
            [id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: "Caja no encontrada" });
            return;
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error en reabrirCaja:', error);
        res.status(500).json({ error: "Error al reabrir caja", details: (error as Error).message });
    }
};

export const cajaLogueada = async (req: Request, res: Response): Promise<void> => {
    const usuarioId = (req as RequestWithUser).user?.id;

    try {
        const result = await query(
            `SELECT c.id, c.apertura, c.cierre, c.estado, c.descripcion, c.creado_en, c.usuario_id, u.nombre as usuario
             FROM cajas c
             JOIN usuarios u ON u.caja_logueada = c.id
             WHERE u.id = $1`,
            [usuarioId]
        );

        res.status(200).json(result.rows[0] || null);
    } catch (error) {
        console.error('Error en cajaLogueada:', error);
        res.status(500).json({ error: "Error al obtener caja logueada", details: (error as Error).message });
    }
};

export const loguearCaja = async (req: Request, res: Response): Promise<void> => {
    const usuarioId = (req as RequestWithUser).user?.id;
    const { cajaId } = req.body;

    try {
        if (cajaId) {
            const cajaExiste = await query(`SELECT id FROM cajas WHERE id = $1`, [cajaId]);
            if (cajaExiste.rows.length === 0) {
                res.status(404).json({ error: "Caja no encontrada" });
                return;
            }
        }

        await query(
            `UPDATE usuarios
             SET caja_logueada = $1
             WHERE id = $2`,
            [cajaId || null, usuarioId]
        );

        res.status(200).json({
            message: cajaId ? "Caja logueada correctamente" : "Caja deslogueada",
            cajaId: cajaId || null
        });
    } catch (error) {
        console.error('Error en loguearCaja:', error);
        res.status(500).json({ error: "Error al loguear/desloguear caja", details: (error as Error).message });
    }
};