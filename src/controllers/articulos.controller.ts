import { Request, Response } from 'express';
import { query } from '../db/db.js';

interface RequestWithUser extends Request {
    user?: {
        id: number;
    }
}

export const cargarArticulos = async (req: Request, res: Response) => {
    try {
        const consultaSQL = `SELECT * FROM public.articulo WHERE activo = true ORDER BY id DESC`;

        const result = await query(consultaSQL);

        if (!result || !result.rows) {
            return res.status(200).json([]);
        }

        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error en cargarArticulos:', error);
        res.status(500).json({
            error: 'Error al cargar artículos',
            details: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
}

export const obtenerArticuloRapido = async (req: Request, res: Response) => {
    try {
        const { cantidad, id } = req.body;

        if (!id) {
            return res.status(400).json({ error: 'ID requerido' });
        }

        const cantidadNum = Number(cantidad);
        const idNum = Number(id);

        const consultaSQL = `
            SELECT 
    id, 
    codigo, 
    nombre, 
    descripcion, 
    categoria, 
    precio_venta, 
    precio_compra, 
    iva_porcentaje, 
    $2::numeric as cantidad_solicitada,
    (precio_venta * $2::numeric)::numeric(18,2) as valor_subtotal,
    CASE 
        WHEN iva_porcentaje = 10 THEN ((precio_venta * $2::numeric) / 11)::numeric(18,2)
        WHEN iva_porcentaje = 5 THEN ((precio_venta * $2::numeric) / 21)::numeric(18,2)
        ELSE ((precio_venta * $2::numeric) * (iva_porcentaje / 100))::numeric(18,2)
    END as valor_iva,
    (precio_venta * $2::numeric)::numeric(18,2) as valor_total
FROM public.articulo 
WHERE id = $1::integer OR codigo = $1::text 
    AND activo = true
        `;

        const result = await query(consultaSQL, [cantidadNum, idNum]);

        if (!result || !result.rows || !result.rows.length) {
            return res.status(404).json({ error: 'Artículo no encontrado' });
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error en obtenerArticuloRapido:', error);
        res.status(500).json({
            error: 'Error al obtener artículo',
            details: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
}