import { Request, Response } from 'express';
import { query, pool } from '../db/db.js';
import { generarProximoNumero, obtenerProximoNumero } from './timbrado.controller.js';
import axios from 'axios';

interface RequestWithUser extends Request {
    user?: {
        id: number;
        token: string;
    }
}

interface FormData {
    caja_id: number;
    estado: string;
    fecha: string;
    moneda_id: number;
    numero_comprobante: string;
    observacion: string;
    operacion_id: number;
    persona_id: string;
    timbrado: number;
    tipo_comprobante: string;
    usuario_id: number;
    valor_descuento: number;
    valor_iva: number;
    valor_subtotal: number;
    valor_total: number;
}

interface FormDetalle {
    articulo_id: number;
    cantidad: number;
    categoria_gasto_ingreso: number;
    descripcion: string;
    iva: number;
    numero_linea: number;
    precio_unitario: number;
    valor_descuento: number;
    valor_iva: number;
    valor_total: number;
}

interface FormPago {
    cuenta_id: number;
    forma_pago: string;
    moneda_id: number;
    tipo_cambio: number;
    observacion: string;
    valor: number;
    valor_convertido: number;
    vuelto?: number;
    moneda_vuelto_id?: number;
    tipo_cambio_vuelto?: number;
    valor_vuelto_convertido?: number;
    vencimiento?: string;
}

interface PayloadTransaccion {
    formData: FormData;
    formDetalle: FormDetalle[];
    formPago: FormPago[];
}

export const crearTransaccion = async (req: Request, res: Response) => {
    const client = await pool.connect();

    const obtenerMensajeError = (error: unknown): string => {
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === 'string') {
            return error;
        }
        if (error && typeof error === 'object') {
            const errorObj = error as Record<string, any>;
            return (
                errorObj.message ||
                errorObj.error ||
                errorObj.detail ||
                errorObj.details ||
                errorObj.hint ||
                'Error desconocido'
            );
        }
        return 'Error desconocido';
    };

    const rollbackSeguro = async () => {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            console.error('Error durante ROLLBACK:', rollbackError);
        }
    };

    try {
        const payload: PayloadTransaccion = req.body;

        // Validaciones del payload
        if (!payload.formData || !payload.formDetalle || !payload.formPago) {
            return res.status(400).json({
                message: 'Payload incompleto',
                details: 'Se requieren formData, formDetalle y formPago'
            });
        }

        if (payload.formDetalle.length === 0) {
            return res.status(400).json({
                message: 'Detalle vacío',
                details: 'Debe contener al menos una línea de detalle'
            });
        }

        if (payload.formPago.length === 0) {
            return res.status(400).json({
                message: 'Pagos vacíos',
                details: 'Debe contener al menos un pago'
            });
        }

        await client.query('BEGIN');

        const { formData, formDetalle, formPago } = payload;

        const resultOperacion = await client.query(
            `SELECT * FROM operaciones_baja WHERE id = $1 AND activo = true`,
            [formData.operacion_id]
        );

        if (resultOperacion.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                error: 'Operación no encontrada',
                details: `No existe operación activa con id ${formData.operacion_id}`
            });
        }

        const operacion = resultOperacion.rows[0];

        // Buscar timbrado (opcional - puede no existir)
        let timbradoUsado = null;
        if (operacion.timbrado) {
            const resultTimb = await client.query(
                `SELECT * FROM timbrado WHERE timbrado::numeric = $1::numeric`,
                [Number(operacion.timbrado)]
            );
            timbradoUsado = resultTimb.rows.length > 0 ? resultTimb.rows[0] : null;
        }

        let numeroComprobante = formData.numero_comprobante;

        // ==================== 1. CREAR TRANSACCION ====================
        const resultTransaccion = await client.query(
            `INSERT INTO transaccion (
                operacion_id,
                timbrado,
                tipo_comprobante,
                numero_comprobante,
                fecha,
                persona_id,
                usuario_id,
                moneda_id,
                estado,
                observacion,
                valor_subtotal,
                valor_iva,
                valor_descuento,
                valor_total,
                creado_en,
                caja_id
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), $15
            )
            RETURNING id`,
            [
                formData.operacion_id,
                formData.timbrado || null,
                formData.tipo_comprobante || null,
                numeroComprobante || null,
                formData.fecha || new Date(),
                formData.persona_id || null,
                formData.usuario_id,
                formData.moneda_id,
                formData.estado || 'Borrador',
                formData.observacion || null,
                formData.valor_subtotal,
                formData.valor_iva,
                formData.valor_descuento,
                formData.valor_total,
                formData.caja_id
            ]
        );

        const transaccionId = resultTransaccion.rows[0].id;

        // ==================== 2. INSERTAR DETALLES TRANSACCION ====================
        for (const detalle of formDetalle) {
            await client.query(
                `INSERT INTO detalle_transaccion (
                    transaccion_id,
                    numero_linea,
                    articulo_id,
                    descripcion,
                    cantidad,
                    precio_unitario,
                    iva,
                    valor_descuento,
                    valor_iva,
                    valor_total,
                    categoria_gasto_ingreso
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
                )`,
                [
                    transaccionId,
                    detalle.numero_linea,
                    detalle.articulo_id || null,
                    detalle.descripcion,
                    detalle.cantidad,
                    detalle.precio_unitario,
                    detalle.iva,
                    detalle.valor_descuento,
                    detalle.valor_iva,
                    detalle.valor_total,
                    detalle.categoria_gasto_ingreso || null
                ]
            );
        }

        // ==================== 3. INSERTAR MOVIMIENTOS DE STOCK ====================
        for (const detalle of formDetalle) {
            if (detalle.articulo_id) {

                await client.query(
                    `INSERT INTO movimiento_stock (
                        articulo_id,
                        almacen_id,
                        tipo_movimiento,
                        cantidad,
                        costo_unitario,
                        documento_tipo,
                        documento_id,
                        usuario_id,
                        creado_en
                    )
                    VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, NOW()
                    )`,
                    [
                        detalle.articulo_id,
                        operacion.almacen_id || 1,
                        operacion.genera_movimiento_stock ? operacion.tipo_movimiento_stock : 'Sin Cambios',
                        detalle.cantidad,
                        detalle.precio_unitario,
                        operacion.modulo,
                        transaccionId,
                        formData.usuario_id
                    ]
                );
            }
        }

        // ==================== 4. CREAR BAJA (UNA por transaccion) ====================
        const resultBaja = await client.query(
            `INSERT INTO baja (
                transaccion_id,
                usuario_id,
                caja_id,
                tipo_transaccion,
                tipo_comprobante,
                comprobante,
                observacion,
                moneda_id,
                fecha,
                estado,
	            persona_id
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10
            )
            RETURNING id`,
            [
                transaccionId,
                formData.usuario_id,
                formData.caja_id,
                operacion.modulo,
                formData.tipo_comprobante || null,
                numeroComprobante || null,
                formData.observacion || null,
                formData.moneda_id,
                'Efectivado',
                formData.persona_id

            ]
        );

        const bajaId = resultBaja.rows[0].id;

        // ==================== 5. INSERTAR DETALLES BAJA POR CATEGORIAS ====================
        const categoriasUnicas = [...new Set(formDetalle.map(d => d.categoria_gasto_ingreso))];

        for (const categoria of categoriasUnicas) {
            const detallesCategoria = formDetalle.filter(
                d => d.categoria_gasto_ingreso === categoria
            );

            const totalValor = detallesCategoria.reduce((sum, d) => sum + d.valor_total, 0);
            const totalIva = detallesCategoria.reduce((sum, d) => sum + d.valor_iva, 0);

            await client.query(
                `INSERT INTO detalle_baja (
                    baja_id,
                    categoria_gasto_ingreso,
                    moneda_id,
                    naturaleza_financiera,
                    valor,
                    valor_convertido
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6
                )`,
                [
                    bajaId,
                    categoria,
                    formData.moneda_id,
                    operacion.genera_movimiento_financiero_categoria ? operacion.naturaleza_financiera : 'Sin Cambios',
                    totalValor,
                    totalValor
                ]
            );
        }

        // ==================== 6. INSERTAR DETALLES BAJA POR PAGOS (cuentas) ====================
        for (const pago of formPago) {
            const naturalezaPago = operacion.genera_movimiento_financiero_cuenta ? operacion.naturaleza_financiera : 'Sin Cambios';
            if (pago.valor > 0) {

                await client.query(
                    `INSERT INTO detalle_baja (
                    baja_id,
                    forma_pago,
                    cuenta_id,
                    moneda_id,
                    tipo_cambio,
                    naturaleza_financiera,
                    valor,
                    valor_convertido,
                    observacion,
                    vencimiento
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
                )`,
                    [
                        bajaId,
                        pago.forma_pago,
                        pago.cuenta_id,
                        pago.moneda_id,
                        pago.tipo_cambio,
                        naturalezaPago,
                        pago.valor,
                        pago.valor_convertido ? pago.valor_convertido : (pago.valor * pago.tipo_cambio),
                        pago.observacion || null,
                        pago.vencimiento
                    ]
                );
            }

            if (pago.vuelto && pago.vuelto > 0 && pago.moneda_id != pago.moneda_vuelto_id) {
                const monedaVuelto = pago.moneda_vuelto_id;
                const tipoCambioVuelto = pago.tipo_cambio_vuelto || 1;
                const valorVueltoConvertido = pago.valor_vuelto_convertido || (pago.vuelto * tipoCambioVuelto);

                await client.query(
                    `INSERT INTO detalle_baja (
                        baja_id,
                        forma_pago,
                        cuenta_id,
                        moneda_id,
                        tipo_cambio,
                        naturaleza_financiera,
                        valor,
                        valor_convertido,
                        observacion
                    )
                    VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9
                    )`,
                    [
                        bajaId,
                        pago.forma_pago,
                        pago.cuenta_id,
                        monedaVuelto,
                        tipoCambioVuelto,
                        naturalezaPago === 'Salida' ? 'Entrada' : 'Salida',
                        pago.vuelto,
                        valorVueltoConvertido,
                        `Vuelto Otorgado`
                    ]
                );
            }
        }

        // ==================== 7. COMMIT ====================
        await client.query('COMMIT');

        // ==================== 8. GENERAR PROXIMO NUMERO (DESPUÉS DE CONFIRMAR TRANSACCIÓN) ====================
        // Solo si:
        // 1. Hay timbrado disponible
        // 2. No se proporcionó número de comprobante manualmente
        // 3. La operación tiene timbrado configurado
        if (timbradoUsado && formData.numero_comprobante && operacion.timbrado) {
            try {
                console.log('✅ Generando próximo número de comprobante...');
                console.log({
                    timbrado: Number(operacion.timbrado),
                    sucursal: Number(timbradoUsado.sucursal),
                    punto_expedicion: Number(timbradoUsado.punto_expedicion),
                    tipo_transaccion: operacion.modulo.toLowerCase(),
                    tipo_nota: formData.tipo_comprobante,
                    proximo_numero: Number(timbradoUsado.proximo_numero),
                    numero_maximo: Number(timbradoUsado.numero_maximo)
                });

                const resultProximoNumero = await obtenerProximoNumero(
                    Number(operacion.timbrado),
                    Number(timbradoUsado.sucursal),
                    Number(timbradoUsado.punto_expedicion),
                    operacion.modulo.toLowerCase(),
                    formData.tipo_comprobante,
                    Number(timbradoUsado.proximo_numero),
                    Number(timbradoUsado.numero_maximo)
                );

                if (resultProximoNumero && resultProximoNumero.proximo_numero) {
                    numeroComprobante = resultProximoNumero.proximo_numero.toString();
                    console.log('✅ Próximo número generado:', numeroComprobante);
                } else {
                    console.warn('⚠️ obtenerProximoNumero retornó resultado inválido:', resultProximoNumero);
                }

            } catch (error) {
                console.error('⚠️ Error al generar próximo número (no crítico):', error);
                // No es crítico - la transacción ya se creó correctamente
            }
        } else if (!timbradoUsado) {
            console.log('ℹ️ Sin timbrado disponible - número de comprobante no será generado');
        } else if (formData.numero_comprobante) {
            console.log('ℹ️ Número de comprobante proporcionado manualmente - no se generará automáticamente');
        }

        return res.status(201).json({
            message: 'Transacción creada exitosamente',
            transaccionId,
            bajaId,
            numeroComprobante: numeroComprobante,
            detalles: formDetalle.length,
            pagos: formPago.length,
            categorias: categoriasUnicas.length,
            totales: {
                subtotal: formData.valor_subtotal,
                iva: formData.valor_iva,
                descuento: formData.valor_descuento,
                total: formData.valor_total
            }
        });

    } catch (error) {
        await rollbackSeguro();

        const mensaje = obtenerMensajeError(error);
        console.error('❌ Error en crearTransaccion:', error);

        return res.status(500).json({
            message: mensaje,
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    } finally {
        client.release();
    }
};

/* export const crearTransaccion = async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
        const payload: PayloadTransaccion = req.body;

        // ✅ VALIDACIÓN 1: Estructura del payload
        if (!payload.formData || !payload.formDetalle || !payload.formPago) {
            return res.status(400).json({
                error: 'Payload incompleto',
                details: 'Se requieren formData, formDetalle y formPago'
            });
        }

        // ✅ VALIDACIÓN 2: Detalle no vacío
        if (payload.formDetalle.length === 0) {
            return res.status(400).json({
                error: 'Detalle vacío',
                details: 'Debe contener al menos una línea de detalle'
            });
        }

        // ✅ VALIDACIÓN 3: Pagos no vacíos
        if (payload.formPago.length === 0) {
            return res.status(400).json({
                error: 'Pagos vacíos',
                details: 'Debe contener al menos un pago'
            });
        }

        await client.query('BEGIN');

        const { formData, formDetalle, formPago } = payload;

        // ✅ VALIDACIÓN 4: Operación existe y está activa
        const resultOperacion = await client.query(
            `SELECT * FROM operaciones_baja WHERE id = $1 AND activo = true`,
            [formData.operacion_id]
        );

        if (resultOperacion.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                error: 'Operación no encontrada',
                details: `No existe operación activa con id ${formData.operacion_id}`
            });
        }

        const operacion: OperacionBaja = resultOperacion.rows[0];

        // ✅ VALIDACIÓN 5: Timbrado existe
        const resultTimb = await client.query(
            `SELECT * FROM timbrado WHERE timbrado::numeric = $1::numeric`,
            [Number(operacion.timbrado)]
        );

        if (resultTimb.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'Timbrado no encontrado',
                details: `No existe timbrado con número ${operacion.timbrado}`
            });
        }

        const timbradoUsado = resultTimb.rows[0];
        let numeroComprobante = formData.numero_comprobante;

        // ✅ VALIDACIÓN 6: Obtener próximo número de comprobante (SI FALLA, NO CONTINUAR)
        if (!formData.numero_comprobante) {
            const timbradoData = {
                timbrado: Number(operacion.timbrado),
                sucursal: Number(timbradoUsado?.sucursal),
                punto_expedicion: Number(timbradoUsado?.punto_expedicion),
                tipo_transaccion: operacion.modulo.toLowerCase(),
                tipo_nota: formData.tipo_comprobante,
                proximo_numero: Number(timbradoUsado?.proximo_numero),
                numero_maximo: timbradoUsado?.numero_maximo
            };

            console.log('Datos de timbrado:', timbradoData);

            try {
                // ✅ VALIDAR QUE OBTENERPROXIMONUMERO NO RETORNE ERROR
                const resultProximoNumero = await obtenerProximoNumero(
                    Number(operacion.timbrado),
                    Number(timbradoUsado?.sucursal),
                    Number(timbradoUsado?.punto_expedicion),
                    operacion.modulo.toLowerCase(),
                    formData.tipo_comprobante,
                    Number(timbradoUsado?.proximo_numero),
                    timbradoUsado?.numero_maximo
                );

                // ✅ VALIDACIÓN 7: Verificar que el resultado sea válido
                if (!resultProximoNumero || !resultProximoNumero.proximo_numero) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        error: 'Error al obtener próximo número de comprobante',
                        details: 'No se pudo generar el número de comprobante. Verifique los datos del timbrado.',
                        timbradoInfo: timbradoData
                    });
                }

                // ✅ VALIDACIÓN 8: Verificar que no exceda el número máximo
                if (resultProximoNumero.proximo_numero > timbradoUsado?.numero_maximo) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        error: 'Número de comprobante excede el máximo permitido',
                        details: `El próximo número (${resultProximoNumero.proximo_numero}) excede el máximo (${timbradoUsado?.numero_maximo})`,
                        timbradoInfo: {
                            timbrado: operacion.timbrado,
                            proximoNumero: resultProximoNumero.proximo_numero,
                            numeroMaximo: timbradoUsado?.numero_maximo
                        }
                    });
                }

                numeroComprobante = resultProximoNumero.proximo_numero.toString();
                console.log('Próximo número de comprobante generado:', numeroComprobante);

            } catch (error) {
                await client.query('ROLLBACK');
                console.error('Error al obtener próximo número:', error);
                return res.status(400).json({
                    error: 'Error al procesar timbrado',
                    details: error instanceof Error ? error.message : 'Error desconocido al generar número de comprobante'
                });
            }
        }

        // ✅ VALIDACIÓN 9: Crear transacción principal
        let transaccionId: number;
        try {
            const resultTransaccion = await client.query(
                `INSERT INTO transaccion (
                    operacion_id, timbrado, tipo_comprobante, numero_comprobante, 
                    fecha, persona_id, usuario_id, moneda_id, 
                    tipo_cambio, subtotal, iva, descuento_total, total, total_moneda_base, 
                    estado, observacion, creado_en, actualizado_en
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
                RETURNING id`,
                [
                    formData.operacion_id,
                    formData.timbrado || operacion.timbrado || null,
                    formData.tipo_comprobante,
                    numeroComprobante || null,
                    formData.fecha || new Date(),
                    formData.persona_id || null,
                    formData.usuario_id,
                    formData.moneda_id,
                    formData.tipo_cambio || 1,
                    formData.subtotal,
                    formData.iva,
                    formData.descuento_total || 0,
                    formData.total,
                    formData.total_moneda_base || 0,
                    formData.estado || 'Borrador',
                    formData.observacion || null
                ]
            );

            if (!resultTransaccion.rows[0]?.id) {
                await client.query('ROLLBACK');
                return res.status(500).json({
                    error: 'Error al crear transacción',
                    details: 'No se pudo obtener el ID de la transacción creada'
                });
            }

            transaccionId = resultTransaccion.rows[0].id;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error al insertar transacción:', error);
            return res.status(400).json({
                error: 'Error al crear transacción',
                details: error instanceof Error ? error.message : 'Error desconocido'
            });
        }

        const detalleIds: number[] = [];

        // ✅ VALIDACIÓN 10: Insertar detalles (si uno falla, rollback)
        for (const detalle of formDetalle) {
            try {
                // Validar datos del detalle
                if (!detalle.numero_linea || detalle.cantidad === undefined || !detalle.precio_unitario) {
                    throw new Error(`Detalle incompleto en línea ${detalle.numero_linea}: faltan campos requeridos`);
                }

                const resultDetalle = await client.query(
                    `INSERT INTO detalle_transaccion (
                        transaccion_id, numero_linea, articulo_id, descripcion, cantidad, 
                        precio_unitario, descuento_valor, subtotal_linea, 
                        iva_porcentaje, iva_linea, total_linea, categoria_gasto_ingreso_id, creado_en
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
                    RETURNING id`,
                    [
                        transaccionId,
                        detalle.numero_linea,
                        detalle.articulo_id || null,
                        detalle.descripcion,
                        detalle.cantidad,
                        detalle.precio_unitario,
                        detalle.descuento_valor || 0,
                        detalle.subtotal_linea,
                        detalle.iva_porcentaje || 0,
                        detalle.iva_linea || 0,
                        detalle.total_linea,
                        detalle.categoria_gasto_ingreso_id || operacion.categoria_id || null
                    ]
                );

                const detalleId = resultDetalle.rows[0]?.id;
                if (!detalleId) {
                    throw new Error(`No se pudo obtener ID del detalle de línea ${detalle.numero_linea}`);
                }

                detalleIds.push(detalleId);

                // ✅ VALIDACIÓN 11: Movimiento de stock (si aplica y falla, rollback)
                if (operacion.genera_movimiento_stock && detalle.articulo_id) {
                    const almacenId = operacion.almacen_id;

                    if (!almacenId) {
                        throw new Error(`La operación genera movimiento de stock pero no tiene almacén_id configurado`);
                    }

                    try {
                        await client.query(
                            `INSERT INTO movimiento_stock (
                                articulo_id, almacen_id, tipo_movimiento, cantidad, costo_unitario,
                                documento_tipo, documento_id, referencia, usuario_id, creado_en
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
                            [
                                detalle.articulo_id,
                                almacenId,
                                operacion.tipo_movimiento_stock,
                                Math.abs(detalle.cantidad),
                                detalle.precio_unitario,
                                'transaccion',
                                transaccionId,
                                `Línea ${detalle.numero_linea} - ${numeroComprobante || 'Sin comprobante'}`,
                                formData.usuario_id
                            ]
                        );
                    } catch (error) {
                        throw new Error(`Error al crear movimiento de stock para línea ${detalle.numero_linea}: ${error instanceof Error ? error.message : 'Error desconocido'}`);
                    }
                }

            } catch (error) {
                await client.query('ROLLBACK');
                console.error('Error al procesar detalle:', error);
                return res.status(400).json({
                    error: 'Error en detalle de transacción',
                    details: error instanceof Error ? error.message : 'Error desconocido'
                });
            }
        }

        const bajaIds: number[] = [];
        const resumenPagos: any[] = [];

        // ✅ VALIDACIÓN 12: Procesar pagos (si uno falla, rollback)
        for (let pagoIndex = 0; pagoIndex < formPago.length; pagoIndex++) {
            try {
                const pago = formPago[pagoIndex];

                // Validar datos del pago
                if (!pago.forma_pago || pago.monto === undefined) {
                    throw new Error(`Pago incompleto en índice ${pagoIndex}: faltan forma_pago o monto`);
                }

                if (pago.monto < 0) {
                    throw new Error(`Pago inválido en índice ${pagoIndex}: monto no puede ser negativo`);
                }

                const tipoChanged = pago.tipo_cambio || 1;
                const monto = pago.monto || 0;
                const valorEnMonedaBase = monto * tipoChanged;
                const cuentaId = operacion.genera_movimiento_financiero_cuenta ? pago.cuenta_id : null;

                let bajaId = null;

                // ✅ VALIDACIÓN 13: Crear baja si aplica (si falla, rollback)
                if (operacion.genera_movimiento_financiero_cuenta) {
                    if (!pago.cuenta_id && operacion.genera_movimiento_financiero_cuenta) {
                        throw new Error(`Pago ${pagoIndex + 1}: La operación requiere cuenta_id pero no fue proporcionada`);
                    }

                    try {
                        const resultBaja = await client.query(
                            `INSERT INTO baja (
                                operacion_id, tipo_movimiento, movimiento_id, fecha, naturaleza_financiera, 
                                persona_id, cuenta_id, caja_id, categoria_gasto_ingreso_id, moneda_id, 
                                cambio, valor, valor_convertido, valor_moneda_base, forma_pago, estado, 
                                fecha_vencimiento, usuario_id, descripcion, observacion, numero_comprobante, 
                                creado_en, actualizado_en
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW())
                            RETURNING id`,
                            [
                                formData.operacion_id,                      // $1
                                operacion.modulo,                          // $2
                                transaccionId,                             // $3
                                formData.fecha,                            // $4
                                operacion.naturaleza_financiera,           // $5
                                formData.persona_id || null,               // $6
                                cuentaId || null,                          // $7
                                formData.caja_id || null,                  // $8
                                operacion.genera_movimiento_financiero_categoria ? formDetalle[0]?.categoria_gasto_ingreso_id || operacion.categoria_id : null, // $9
                                pago.moneda_id,                            // $10
                                tipoChanged,                               // $11
                                monto,                                     // $12
                                monto * tipoChanged,                       // $13
                                valorEnMonedaBase,                         // $14
                                pago.forma_pago,                           // $15
                                'Efectivado',                              // $16
                                pago.vencimiento || null,                  // $17
                                pago.usuario_id || formData.usuario_id,    // $18
                                `${formDetalle[0]?.descripcion || formData.descripcion} - Pago ${pagoIndex + 1} (${pago.forma_pago})`, // $19
                                formData.observacion || null,              // $20
                                numeroComprobante || null                  // $21
                            ]
                        );

                        if (!resultBaja.rows[0]?.id) {
                            throw new Error(`No se pudo obtener ID de la baja para pago ${pagoIndex + 1}`);
                        }

                        bajaId = resultBaja.rows[0].id;
                        bajaIds.push(bajaId);
                    } catch (error) {
                        throw new Error(`Error al crear baja para pago ${pagoIndex + 1}: ${error instanceof Error ? error.message : 'Error desconocido'}`);
                    }
                }

                // ✅ VALIDACIÓN 14: Crear registro de pago (si falla, rollback)
                try {
                    await client.query(
                        `INSERT INTO pago (
                            baja_id, numero_pago, fecha_pago, monto, forma_pago, 
                            referencia_pago, moneda_id, tipo_cambio, estado, usuario_id, 
                            observacion, vencimiento, creado_en, actualizado_en, cuenta_id
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(), $13)`,
                        [
                            bajaId || null,
                            pago.numero_pago,
                            formData.fecha,
                            monto,
                            pago.forma_pago,
                            pago.referencia_pago || null,
                            pago.moneda_id,
                            tipoChanged,
                            pago.estado || 'Efectivado',
                            pago.usuario_id || formData.usuario_id,
                            pago.observacion || null,
                            pago.vencimiento || null,
                            cuentaId || null
                        ]
                    );
                } catch (error) {
                    throw new Error(`Error al crear pago ${pagoIndex + 1}: ${error instanceof Error ? error.message : 'Error desconocido'}`);
                }

                resumenPagos.push({
                    numeroPago: pagoIndex + 1,
                    formaPago: pago.forma_pago,
                    moneda: pago.moneda_id,
                    monto: pago.monto,
                    tipoCambio: tipoChanged,
                    bajaId: bajaId
                });

                // ✅ VALIDACIÓN 15: Procesar vuelto si existe (si falla, rollback)
                if (pago.vuelto && pago.vuelto > 0) {
                    try {
                        const vueltoAmount = pago.vuelto;
                        const vueltoEnMonedaBase = vueltoAmount * tipoChanged;
                        const naturalezaVuelto = operacion.naturaleza_financiera === 'Salida' ? 'Entrada' : 'Salida';

                        const resultBajaVuelto = await client.query(
                            `INSERT INTO baja (
                                operacion_id, tipo_movimiento, movimiento_id, fecha, naturaleza_financiera, 
                                persona_id, cuenta_id, caja_id, categoria_gasto_ingreso_id, moneda_id, 
                                cambio, valor, valor_convertido, valor_moneda_base, forma_pago, estado, 
                                fecha_vencimiento, usuario_id, descripcion, observacion, numero_comprobante, 
                                creado_en, actualizado_en
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW())
                            RETURNING id`,
                            [
                                formData.operacion_id,                      // $1
                                operacion.modulo,                          // $2
                                transaccionId,                             // $3
                                formData.fecha,                            // $4
                                naturalezaVuelto,                          // $5
                                formData.persona_id || null,               // $6
                                cuentaId || null,                          // $7
                                formData.caja_id || null,                  // $8
                                operacion.genera_movimiento_financiero_categoria ? formDetalle[0]?.categoria_gasto_ingreso_id || operacion.categoria_id : null, // $9
                                pago.moneda_id,                            // $10
                                tipoChanged,                               // $11
                                vueltoAmount,                              // $12
                                vueltoAmount * tipoChanged,                // $13
                                vueltoEnMonedaBase,                        // $14
                                pago.forma_pago,                           // $15
                                'Efectivado',                              // $16
                                null,                                      // $17
                                pago.usuario_id || formData.usuario_id,    // $18
                                `VUELTO - Pago ${pagoIndex + 1} (${pago.forma_pago})`, // $19
                                `Vuelto de: ${monto} ${pago.moneda_id} - Devuelta: ${vueltoAmount}`, // $20
                                numeroComprobante || null                  // $21
                            ]
                        );

                        if (!resultBajaVuelto.rows[0]?.id) {
                            throw new Error(`No se pudo obtener ID de la baja de vuelto para pago ${pagoIndex + 1}`);
                        }

                        const bajaVueltoId = resultBajaVuelto.rows[0].id;
                        bajaIds.push(bajaVueltoId);

                        await client.query(
                            `INSERT INTO pago (
                                baja_id, numero_pago, fecha_pago, monto, forma_pago, 
                                referencia_pago, moneda_id, tipo_cambio, estado, usuario_id, 
                                observacion, vencimiento, creado_en, actualizado_en, cuenta_id
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(), $13)`,
                            [
                                bajaVueltoId,                              // $1
                                `${pago.numero_pago}-VUELTO`,              // $2
                                pago.fecha_pago || new Date(),             // $3
                                vueltoAmount,                              // $4
                                pago.forma_pago,                           // $5
                                pago.referencia_pago || null,              // $6
                                pago.moneda_id,                            // $7
                                tipoChanged,                               // $8
                                'Efectivado',                              // $9
                                pago.usuario_id || formData.usuario_id,    // $10
                                `Vuelto del pago ${pagoIndex + 1}`,         // $11
                                null,                                      // $12
                                cuentaId || null                           // $13
                            ]
                        );

                        resumenPagos[pagoIndex].bajaVueltoId = bajaVueltoId;
                    } catch (error) {
                        throw new Error(`Error al procesar vuelto del pago ${pagoIndex + 1}: ${error instanceof Error ? error.message : 'Error desconocido'}`);
                    }
                }

            } catch (error) {
                await client.query('ROLLBACK');
                console.error('Error al procesar pago:', error);
                return res.status(400).json({
                    error: 'Error en procesamiento de pago',
                    details: error instanceof Error ? error.message : 'Error desconocido'
                });
            }
        }

        // ✅ Si llegamos aquí, TODO está validado y correcto
        await client.query('COMMIT');

        return res.status(201).json({
            mensaje: 'Transacción creada exitosamente',
            transaccionId,
            numeroComprobante,
            bajaIds,
            bajasPorPago: formPago.length,
            bajasPorVuelto: formPago.filter(p => p.vuelto && p.vuelto > 0).length,
            totalBajas: bajaIds.length,
            detalles: formDetalle.length,
            pagos: formPago.length,
            resumenPagos,
            operacion: {
                id: operacion.id,
                descripcion: operacion.descripcion,
                modulo: operacion.modulo,
                tipoOperacion: operacion.tipo_operacion,
                naturalezaFinanciera: operacion.naturaleza_financiera,
                generaMovimientoStock: operacion.genera_movimiento_stock,
                generaMovimientoFinancieroCategoria: operacion.genera_movimiento_financiero_categoria,
                generaMovimientoFinancieroCuenta: operacion.genera_movimiento_financiero_cuenta
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en crearTransaccion:', error);
        res.status(500).json({
            error: 'Error al crear transacción',
            details: error instanceof Error ? error.message : 'Error desconocido',
            stack: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : '') : undefined
        });
    } finally {
        client.release();
    }
}; */

export const ObtenerTransacciones = async (req: Request, res: Response) => {
    const { tipo_modulo, estado, fecha_inicio, fecha_fin } = req.query;

    try {
        let sql = `
            SELECT 
                t.id, t.operacion_id, t.tipo_comprobante, t.numero_comprobante,
                t.fecha, t.estado, t.subtotal, t.total,
                t.persona_id, p.nombre as persona_nombre,
                t.moneda_id, m.codigo as moneda_codigo,
                t.usuario_id, t.creado_en
            FROM transaccion t
            LEFT JOIN persona p ON t.persona_id = p.id
            LEFT JOIN moneda m ON t.moneda_id = m.id
            WHERE 1=1
        `;

        const params: any[] = [];

        if (tipo_modulo) {
            sql += ` AND t.operacion_id = $${params.length + 1}`;
            params.push(tipo_modulo);
        }

        if (estado) {
            sql += ` AND t.estado = $${params.length + 1}`;
            params.push(estado);
        }

        if (fecha_inicio) {
            sql += ` AND t.fecha >= $${params.length + 1}`;
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            sql += ` AND t.fecha <= $${params.length + 1}`;
            params.push(fecha_fin);
        }

        sql += ` ORDER BY t.fecha DESC, t.id DESC`;

        const result = await query(sql, params);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al obtener transacciones" });
    }
};

export const ObtenerTransaccionPorId = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const txSQL = `
            SELECT 
                t.id, t.operacion_id, t.tipo_comprobante, t.numero_comprobante,
                t.fecha, t.estado, t.persona_id, p.nombre as persona_nombre,
                t.subtotal, t.iva, t.descuento_total, t.total,
                t.moneda_id, m.codigo as moneda_codigo, m.simbolo as moneda_simbolo,
                t.tipo_cambio, t.usuario_id, t.observacion
            FROM transaccion t
            LEFT JOIN persona p ON t.persona_id = p.id
            LEFT JOIN moneda m ON t.moneda_id = m.id
            WHERE t.id = $1
        `;

        const txResult = await query(txSQL, [id]);
        if (txResult.rows.length === 0) {
            return res.status(404).json({ error: "Transacción no encontrada" });
        }

        const transaccion = txResult.rows[0];

        const detallesSQL = `
            SELECT * FROM detalle_transaccion WHERE transaccion_id = $1 ORDER BY numero_linea
        `;
        const detalles = await query(detallesSQL, [id]);

        const bajasSQL = `
            SELECT b.*, m.codigo as moneda_codigo, m.simbolo
            FROM baja b
            LEFT JOIN moneda m ON b.moneda_id = m.id
            WHERE b.transaccion_id = $1
            ORDER BY b.id
        `;
        const bajas = await query(bajasSQL, [id]);

        const pagosSQL = `
            SELECT p.*, m.codigo as moneda_codigo
            FROM pago p
            LEFT JOIN moneda m ON p.moneda_id = m.id
            WHERE p.baja_id IN (SELECT id FROM baja WHERE transaccion_id = $1)
            ORDER BY p.id
        `;
        const pagos = await query(pagosSQL, [id]);

        res.status(200).json({
            transaccion,
            detalles: detalles.rows,
            bajas: bajas.rows,
            pagos: pagos.rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al obtener transacción" });
    }
};

export const ActualizarTransaccion = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { estado, observacion } = req.body;

    try {
        const updateSQL = `
            UPDATE transaccion 
            SET estado = COALESCE($1, estado),
                observacion = COALESCE($2, observacion),
                actualizado_en = NOW()
            WHERE id = $3
            RETURNING *
        `;

        const result = await query(updateSQL, [estado || null, observacion || null, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Transacción no encontrada" });
        }

        res.status(200).json({ message: "Transacción actualizada", data: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al actualizar transacción" });
    }
};

export const AnularTransaccion = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { motivo_anulacion } = req.body;

    try {
        const updateSQL = `
            UPDATE transaccion 
            SET estado = 'Cancelada', 
                actualizado_en = NOW(), 
                anulado_en = NOW(),
                motivo_anulacion = $1
            WHERE id = $2
            RETURNING *
        `;

        const result = await query(updateSQL, [motivo_anulacion || null, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Transacción no encontrada" });
        }

        // También actualizar las bajas asociadas
        await query(`
            UPDATE baja SET estado = 'Cancelada', actualizado_en = NOW()
            WHERE transaccion_id = $1
        `, [id]);

        res.status(200).json({ message: "Transacción anulada", data: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al anular transacción" });
    }
};

