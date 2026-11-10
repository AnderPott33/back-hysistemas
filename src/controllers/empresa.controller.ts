import { Request, Response } from 'express';
import { query } from '../db/db.js';

interface RequestWithUser extends Request {
    user?: {
        id: number;
    }
}

export const crearActualizarEmpresa = async (req: Request, res: Response) => {
    const {
        id, ruc, fantasia, razon_social, direccion, telefono, email,
        ciudad, departamento, pais, moneda_base, id_csc, csc, contrasena_certificado,
        regimen_contable, cliente_predeterminado, operacion_preseleccionada_venta,
        operacion_preseleccionada_nota_fiscal, operacion_preseleccionada_compra,
        activo, actividad_economica, operacion_preseleccionada_ingreso, operacion_preseleccionada_gasto
    } = req.body;

    const consultaInsert = `
        INSERT INTO empresa (
            ruc, fantasia, razon_social, direccion, telefono, email,
            ciudad, departamento, pais, moneda_base, id_csc, csc, 
            contrasena_certificado, regimen_contable, cliente_predeterminado, 
            operacion_preseleccionada_venta, operacion_preseleccionada_nota_fiscal,
            operacion_preseleccionada_compra, activo, actividad_economica, operacion_preseleccionada_ingreso, operacion_preseleccionada_gasto
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
    `;

    const consultaUpdate = `
        UPDATE empresa SET 
            ruc = $1,
            fantasia = $2,
            razon_social = $3,
            direccion = $4,
            telefono = $5,
            email = $6,
            ciudad = $7,
            departamento = $8,
            pais = $9,
            moneda_base = $10,
            id_csc = $11,
            csc = $12,
            contrasena_certificado = $13,
            regimen_contable = $14,
            cliente_predeterminado = $15,
            operacion_preseleccionada_venta = $16,
            operacion_preseleccionada_nota_fiscal = $17,
            operacion_preseleccionada_compra = $18,
            operacion_preseleccionada_ingreso = $22,
             operacion_preseleccionada_gasto = $23,
            activo = $19,
            actividad_economica = $20
        WHERE id = $21
    `;

    try {
        if (id) {
            const result = await query(consultaUpdate, [
                ruc, fantasia, razon_social, direccion, telefono, email,
                ciudad, departamento, pais, moneda_base, id_csc, csc,
                contrasena_certificado, regimen_contable, cliente_predeterminado,
                operacion_preseleccionada_venta, operacion_preseleccionada_nota_fiscal,
                operacion_preseleccionada_compra, activo,
                JSON.stringify(actividad_economica || []),
                id, operacion_preseleccionada_ingreso, operacion_preseleccionada_gasto
            ]);

            if (result) {
                res.status(200).json({ message: 'Empresa actualizada correctamente', type: 'success' });  // ✅ 200 para UPDATE, no 201
            } else {
                res.status(500).json({ message: 'Error al actualizar', type: 'error' });
            }
        } else {
            const result = await query(consultaInsert, [
                ruc, fantasia, razon_social, direccion, telefono, email,
                ciudad, departamento, pais, moneda_base, id_csc, csc,
                contrasena_certificado, regimen_contable, cliente_predeterminado,
                operacion_preseleccionada_venta, operacion_preseleccionada_nota_fiscal,
                operacion_preseleccionada_compra, activo,
                JSON.stringify(actividad_economica || []), operacion_preseleccionada_ingreso, operacion_preseleccionada_gasto
            ]);

            if (result) {
                res.status(201).json({ message: 'Empresa agregada correctamente', type: 'success' });
            } else {
                res.status(500).json({ message: 'Error al crear', type: 'error' });
            }
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error interno del servidor', error });
    }
};

export const buscarEmpresa = async (req: Request, res: Response) => {
    const consultaSQL = `
    SELECT * FROM empresa;
    `;
    try {
        const result = await query(consultaSQL)
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
    }
}

export const buscarEmpresaId = async (req: Request, res: Response) => {
    const { id } = req.params;
    const consultaSQL = `
    SELECT * FROM empresa WHERE id = $1;
    `;
    try {
        const result = await query(consultaSQL, [id])
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
    }
}