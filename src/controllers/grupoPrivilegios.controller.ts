import { Request, Response } from 'express';
import { query } from '../db/db.js';

export const obtenerGrupos = async (req: Request, res: Response) => {
    try {
        const result = await query(
            "SELECT * FROM grupo_privilegios ORDER BY id DESC"
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Error al obtener grupos de privilegios:", error);
        res.status(500).json({ mensaje: "Error al obtener grupos de privilegios" });
    }
};

export const obtenerGrupoPorId = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await query(
            "SELECT * FROM grupo_privilegios WHERE id = $1",
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Grupo de privilegios no encontrado" });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error al obtener grupo de privilegios:", error);
        res.status(500).json({ mensaje: "Error al obtener grupo de privilegios" });
    }
};

export const crearGrupo = async (req: Request, res: Response) => {
    const { nombre, privilegios } = req.body;
    try {
        const result = await query(
            `INSERT INTO grupo_privilegios (nombre, privilegios)
             VALUES ($1, $2) RETURNING *`,
            [nombre, JSON.stringify(privilegios || [])]
        );
        res.status(201).json({ mensaje: "Grupo de privilegios creado", grupo: result.rows[0] });
    } catch (error) {
        console.error("Error al crear grupo de privilegios:", error);
        if (error) {
            return res.status(409).json({ mensaje: "Ya existe un grupo con ese nombre" });
        }
        res.status(500).json({ mensaje: "Error al crear grupo de privilegios" });
    }
};

export const actualizarGrupo = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { nombre, privilegios } = req.body;
    try {
        const result = await query(
            `UPDATE grupo_privilegios
             SET nombre = $1, privilegios = $2
             WHERE id = $3 RETURNING *`,
            [nombre, JSON.stringify(privilegios || []), id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Grupo de privilegios no encontrado" });
        }
        res.json({ mensaje: "Grupo de privilegios actualizado", grupo: result.rows[0] });
    } catch (error) {
        console.error("Error al actualizar grupo de privilegios:", error);
        if (error) {
            return res.status(409).json({ mensaje: "Ya existe un grupo con ese nombre" });
        }
        res.status(500).json({ mensaje: "Error al actualizar grupo de privilegios" });
    }
};

export const eliminarGrupo = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await query(
            "DELETE FROM grupo_privilegios WHERE id = $1 RETURNING *",
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Grupo de privilegios no encontrado" });
        }
        res.json({ mensaje: "Grupo de privilegios eliminado" });
    } catch (error) {
        console.error("Error al eliminar grupo de privilegios:", error);
        res.status(500).json({ mensaje: "Error al eliminar grupo de privilegios" });
    }
};
