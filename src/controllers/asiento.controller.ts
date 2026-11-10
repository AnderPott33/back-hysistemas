import { Request, Response } from 'express';
import { insertarAsientos, ErrorValidacionAsiento, cancelarAsientoPorId, obtenerAsientoPorId } from '../services/asiento.service.js';

interface RequestWithUser extends Request {
    user?: { id: number };
}

export const crearAsientos = async (req: Request, res: Response): Promise<void> => {
    const usuarioId = (req as RequestWithUser).user?.id;
    if (!usuarioId) {
        res.status(401).json({ message: 'No autenticado' });
        return;
    }

    const cuerpo = Array.isArray(req.body) ? req.body : [req.body];
    console.log(cuerpo);
    

    try {
        const ids = await insertarAsientos(cuerpo.map((d) => ({ ...d, usuarioId })));
        res.status(201).json({ ids });
    } catch (error) {
        if (error instanceof ErrorValidacionAsiento) {
            res.status(400).json({ message: error.message });
            return;
        }
        console.error(error);
        res.status(500).json({ message: 'Error al registrar el asiento' });
    }
};

export const cancelarAsiento = async (req: Request, res: Response): Promise<void> => {
    const usuarioId = (req as RequestWithUser).user?.id;
    if (!usuarioId) {
        res.status(401).json({ message: 'No autenticado' });
        return;
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ message: 'ID inválido' });
        return;
    }

    const motivo = String(req.body?.motivo ?? '').trim();

    try {
        const cancelados = await cancelarAsientoPorId(id, usuarioId, motivo);
        res.status(200).json({
            message: cancelados > 1 ? 'Asientos cancelados' : 'Asiento cancelado',
            id,
            cancelados,
        });
    } catch (error) {
        if (error instanceof ErrorValidacionAsiento) {
            res.status(400).json({ message: error.message });
            return;
        }
        console.error(error);
        res.status(500).json({ message: 'Error al cancelar el asiento' });
    }
};
export const obtenerAsiento = async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ message: 'ID inválido' });
        return;
    }

    try {
        const asiento = await obtenerAsientoPorId(id);
        if (!asiento) {
            res.status(404).json({ message: 'Asiento no encontrado' });
            return;
        }
        res.status(200).json(asiento);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al obtener el asiento' });
    }
};