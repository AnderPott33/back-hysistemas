import { Request, Response } from 'express';
import { pool, query } from '../db/db.js';
import {
    insertarAsientos,
    cancelarAsientosDeMovimiento,
    ErrorValidacionAsiento,
    DatosAsiento,
} from '../services/asiento.service.js';

interface RequestWithUser extends Request {
    user?: { id: number };
}

// ---------- CONSULTAS ----------

const QUERY_POR_ID = `
    SELECT
        m.id,
        m.caja_id,
        m.fecha,
        m.usuario_id,
        m.estado,
        m.observacion,
        m.tipo_movimiento,
        m.moneda_id,
        m.motivo_cancelado,
        (
            SELECT json_build_object(
                'id', u.id,
                'nombre', u.nombre,
                'email', u.email,
                'es_usuario_master', u.es_usuario_master,
                'activo', u.activo,
                'rol', json_build_object(
                    'id', r.id,
                    'nombre', r.nombre
                )
            )
            FROM usuarios u
            LEFT JOIN grupo_privilegios r ON r.id = u.grupo_privilegios
            WHERE u.id = m.usuario_id
        ) AS usuario,
        COALESCE((
            SELECT json_agg(b ORDER BY b.id)
            FROM bajas b
            WHERE b.movimiento_id = m.id
        ), '[]'::json) AS bajas,
        COALESCE((
            SELECT json_agg(bc ORDER BY bc.id)
            FROM bajas_caja bc
            WHERE bc.movimiento_id = m.id
        ), '[]'::json) AS bajas_caja
    FROM movimientos m
    WHERE m.id = $1
`;

const QUERY_LISTADO = `
    SELECT
        m.id,
        m.fecha,
        m.estado,
        m.observacion,
        m.tipo_movimiento,
        m.caja_id,
        m.usuario_id,
        m.moneda_id,
        COUNT(b.id)                       AS cantidad_bajas,
        COALESCE(SUM(b.valor_liquido), 0) AS total_valor_liquido,
        COALESCE(SUM(b.valor_liquido) FILTER (
            WHERE b.naturaleza_financiera = 'Crédito'
        ), 0)                             AS total_credito,
        COALESCE(SUM(b.valor_liquido) FILTER (
            WHERE b.naturaleza_financiera = 'Débito'
        ), 0)                             AS total_debito,
        COUNT(*) OVER()                   AS total_registros
    FROM movimientos m
    LEFT JOIN bajas b ON b.movimiento_id = m.id
    WHERE ($3::int IS NULL OR m.caja_id = $3)
    GROUP BY m.id
    ORDER BY m.fecha DESC, m.id DESC
    LIMIT $1 OFFSET $2
`;

// ---------- HELPERS DE BAJAS ----------

const insertarBajas = async (client: any, movimientoId: number, formBaja: any[]) => {
    const sql = `
        INSERT INTO bajas (
            operacion, movimiento_id, titulo_id, documento_id, documento,
            persona_id, categoria_id, cuenta_id, moneda_id, valor, interes,
            descuento, valor_liquido, cambio, valor_convertido, valor_contable,
            emision, vencimiento, compensado, fecha_compensacion,
            naturaleza_financiera, observacion, observacion_auto, forma_pago
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
    `;

    for (const baja of formBaja) {
        await client.query(sql, [
            baja.operacion,
            movimientoId,
            baja.titulo_id,
            baja.documento_id,
            baja.documento,
            baja.persona_id,
            baja.categoria_id,
            baja.cuenta_id,
            baja.moneda_id,
            baja.valor,
            baja.interes,
            baja.descuento,
            baja.valor_liquido,
            baja.cambio,
            baja.valor_convertido,
            baja.valor_contable,
            baja.emision,
            baja.vencimiento ?? null,
            baja.compensado,
            baja.fecha_compensacion,
            baja.naturaleza_financiera,
            baja.observacion,
            baja.observacion_auto,
            baja.forma_pago ?? null
        ]);
    }
};

const insertarBajasCaja = async (client: any, movimientoId: number, formBajaCaja: any[]) => {
    const sql = `
        INSERT INTO bajas_caja (
            movimiento_id, moneda_id, caja_id, valor, vuelto,
            cambio, naturaleza_financiera, valor_contable, forma_pago
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Efectivo')
    `;

    for (const bajaCaja of formBajaCaja) {
        await client.query(sql, [
            movimientoId,
            bajaCaja.moneda_id,
            bajaCaja.caja_id,
            bajaCaja.valor,
            bajaCaja.vuelto,
            bajaCaja.cambio,
            bajaCaja.naturaleza_financiera,
            bajaCaja.valor_contable
        ]);
    }
};

// ---------- HELPERS DE ASIENTOS ----------

const aCentavos = (n: number) => Math.round(n * 100);
const aDosDecimales = (n: number) => Math.round(n * 100) / 100;
const opuesta = (n: string) => (n === 'Débito' ? 'Crédito' : 'Débito');

// valor_convertido es obligatorio cuando valor y valor_contable no coinciden (as_valor_contable_coherente)
const valorConvertidoSi = (valor: number, valorContable: number) =>
    valor === valorContable ? null : valorContable;

const valoresBaja = (baja: any) => {
    const valor = Math.abs(Number(baja.valor_liquido ?? baja.valor));
    const valorContable = Math.abs(Number(baja.valor_contable ?? valor));
    return { valor, valorContable };
};

/**
 * Lado categoría y cuenta de cada baja.
 * - Categoría con cuenta: PAGO/RECIBIMIENTO contra la cuenta.
 * - Categoría sin cuenta: PAGO/RECIBIMIENTO contra la caja, en la moneda de la baja.
 * - Cuenta sin categoría: DEPOSITO/SAQUE, par cuenta + caja.
 * La naturaleza del formulario es la de la baja; en el contenedor va la opuesta.
 * Todos los asientos llevan caja_movimiento = caja en uso del movimiento.
 */
const construirAsientos = (
    movimientoId: number,
    formMovimiento: any,
    formBaja: any[],
    usuarioId: number
): DatosAsiento[] => {
    const cajaId = Number(formMovimiento.caja_id);
    const cajaMovimiento = cajaId;

    return formBaja.flatMap((baja, index): DatosAsiento[] => {
        const linea = index + 1;
        const naturalezaFront = baja.naturaleza_financiera;

        if (naturalezaFront !== 'Débito' && naturalezaFront !== 'Crédito') {
            throw new ErrorValidacionAsiento(
                `La línea ${linea} tiene naturaleza inválida: ${naturalezaFront}`
            );
        }

        const { valor: valorBruto, valorContable: contableBruto } = valoresBaja(baja);
        const valor = aDosDecimales(valorBruto);
        const valorContable = aDosDecimales(contableBruto);

        if (!(valor > 0)) {
            throw new ErrorValidacionAsiento(`La línea ${linea} tiene valor cero`);
        }

        const comun = {
            movimientoId,
            cajaMovimiento,
            monedaId: Number(baja.moneda_id),
            valor,
            cambio: baja.cambio ?? null,
            valorConvertido: baja.valor_convertido ?? valorConvertidoSi(valor, valorContable),
            valorContable,
            personaId: baja.persona_id ?? null,
            tituloId: baja.titulo_id ?? null,
            documentoId: baja.documento_id ?? null,
            documento: baja.documento ?? null,
            vencimiento: baja.vencimiento ?? null,
            historico: baja.observacion || baja.observacion_auto || null,
            fechaContable: formMovimiento.fecha ?? null,
            usuarioId,
        };

        // Caso 1: ingreso o gasto con subcategoría
        if (baja.categoria_id) {
            const tipo = naturalezaFront === 'Crédito' ? 'RECIBIMIENTO' : 'PAGO';

            if (baja.cuenta_id) {
                return [{
                    ...comun,
                    tipoAsiento: tipo,
                    forma_pago: baja.forma_pago ?? null,
                    cuentaId: Number(baja.cuenta_id),
                    cajaId: null,
                    subcategoriaId: Number(baja.categoria_id),
                    naturaleza: opuesta(naturalezaFront),
                } as DatosAsiento];
            }

            return [{
                ...comun,
                tipoAsiento: tipo,
                forma_pago: baja.forma_pago ?? null,
                cajaId,
                cuentaId: null,
                subcategoriaId: Number(baja.categoria_id),
                naturaleza: opuesta(naturalezaFront),
            } as DatosAsiento];
        }

        // Caso 2: depósito o saque contra una cuenta
        if (baja.cuenta_id) {
            const tipo = naturalezaFront === 'Débito' ? 'DEPOSITO' : 'SAQUE';

            return [
                {
                    ...comun,
                    tipoAsiento: tipo,
                    forma_pago: baja.forma_pago ?? null,
                    cuentaId: Number(baja.cuenta_id),
                    cajaId: null,
                    subcategoriaId: null,
                    naturaleza: naturalezaFront,
                } as DatosAsiento,
                {
                    ...comun,
                    tipoAsiento: tipo,
                    forma_pago: baja.forma_pago ?? null,
                    cajaId,
                    cuentaId: null,
                    subcategoriaId: null,
                    naturaleza: opuesta(naturalezaFront),
                } as DatosAsiento,
            ];
        }

        throw new ErrorValidacionAsiento(`La línea ${linea} no tiene subcategoría ni cuenta`);
    });
};

type Disponible = {
    monedaId: number;
    valorCent: number;
    contableCent: number;
    restanteCent: number;
};

/**
 * Conversiones en caja.
 * Una fila de bajas_caja en una moneda que ninguna baja usa se cubre con bajas en otras monedas:
 *  - Salida de caja en la moneda de la baja (por la parte de valor_contable que cubre).
 *  - Entrada a caja en la moneda real de la fila (por la parte proporcional de valor).
 * Las bajas se consumen en orden. Si una fila tiene monedas de baja en su misma moneda,
 * no genera conversión: esa parte ya entra a caja por la línea de la baja.
 * Todos los asientos llevan caja_movimiento = caja en uso del movimiento.
 */
const construirAsientosCaja = (
    movimientoId: number,
    formMovimiento: any,
    formBaja: any[],
    formBajaCaja: any[] | undefined,
    usuarioId: number
): DatosAsiento[] => {
    if (!Array.isArray(formBajaCaja) || formBajaCaja.length === 0) return [];

    const cajaMov = Number(formMovimiento.caja_id);
    const fecha = formMovimiento.fecha ?? null;
    const asientos: DatosAsiento[] = [];

    const disponibles: Disponible[] = formBaja.map((baja) => {
        const { valor, valorContable } = valoresBaja(baja);
        return {
            monedaId: Number(baja.moneda_id),
            valorCent: aCentavos(valor),
            contableCent: aCentavos(valorContable),
            restanteCent: aCentavos(valorContable),
        };
    });

    formBajaCaja.forEach((bc, index) => {
        const linea = index + 1;
        const naturaleza = bc.naturaleza_financiera;

        if (naturaleza !== 'Débito' && naturaleza !== 'Crédito') {
            throw new ErrorValidacionAsiento(
                `La fila de caja ${linea} tiene naturaleza inválida: ${naturaleza}`
            );
        }

        const valorCent = aCentavos(Math.abs(Number(bc.valor)));
        const contableCent = aCentavos(Math.abs(Number(bc.valor_contable ?? bc.valor)));
        if (valorCent === 0) return;

        const monedaCaja = Number(bc.moneda_id);
        const cajaDestino = Number(bc.caja_id ?? cajaMov);

        // Hay bajas en esta moneda: la fila ya está cubierta por sus líneas, sin conversión.
        if (disponibles.some((d) => d.monedaId === monedaCaja)) return;

        if (contableCent === 0) {
            throw new ErrorValidacionAsiento(
                `La fila de caja ${linea} tiene valor contable cero y no se puede convertir`
            );
        }

        const tipo = naturaleza === 'Débito' ? 'DEPOSITO' : 'SAQUE';
        const base = {
            movimientoId,
            cajaMovimiento: cajaMov,
            tipoAsiento: tipo,
            forma_pago: 'Efectivo',
            cuentaId: null,
            subcategoriaId: null,
            personaId: null,
            tituloId: null,
            documentoId: null,
            documento: null,
            vencimiento: null,
            historico: 'Conversión de moneda en caja',
            fechaContable: fecha,
            usuarioId,
        };

        let restanteBc = contableCent;
        let entradaAcumulada = 0;

        for (const d of disponibles) {
            if (restanteBc <= 0) break;
            if (d.restanteCent <= 0) continue;

            const chunk = Math.min(restanteBc, d.restanteCent);
            const esUltimo = chunk === restanteBc;

            const salidaCent = d.contableCent > 0
                ? Math.round((chunk * d.valorCent) / d.contableCent)
                : chunk;
            const entradaCent = esUltimo
                ? valorCent - entradaAcumulada
                : Math.round((valorCent * chunk) / contableCent);

            const valorSalida = salidaCent / 100;
            const valorEntrada = entradaCent / 100;
            const valorContableChunk = chunk / 100;

            // Salida de caja en la moneda de la baja
            asientos.push({
                ...base,
                cajaId: cajaMov,
                forma_pago: 'Efectivo',
                monedaId: d.monedaId,
                naturaleza: opuesta(naturaleza),
                valor: valorSalida,
                cambio: null,
                valorConvertido: valorConvertidoSi(valorSalida, valorContableChunk),
                valorContable: valorContableChunk,
            } as DatosAsiento);

            // Entrada a caja en la moneda real de la fila
            asientos.push({
                ...base,
                cajaId: cajaDestino,
                forma_pago: 'Efectivo',
                monedaId: monedaCaja,
                naturaleza,
                valor: valorEntrada,
                cambio: bc.cambio ?? null,
                valorConvertido: valorConvertidoSi(valorEntrada, valorContableChunk),
                valorContable: valorContableChunk,
            } as DatosAsiento);

            d.restanteCent -= chunk;
            restanteBc -= chunk;
            entradaAcumulada += entradaCent;
        }

        if (restanteBc > 0) {
            throw new ErrorValidacionAsiento(
                `La fila de caja ${linea} no tiene bajas suficientes para cubrir la conversión`
            );
        }
    });

    return asientos;
};

/**
 * Control final: el neto de los asientos de caja por caja y moneda
 * debe ser igual al neto de las filas de bajas_caja.
 */
const validarCajaContraBajasCaja = (
    asientos: DatosAsiento[],
    formBajaCaja: any[],
    cajaMov: number
) => {
    const enAsientos = new Map<string, number>();
    for (const a of asientos) {
        if (a.cajaId == null) continue;
        const clave = `${a.cajaId}|${a.monedaId}`;
        const signo = a.naturaleza === 'Débito' ? 1 : -1;
        enAsientos.set(clave, (enAsientos.get(clave) ?? 0) + signo * aCentavos(a.valor));
    }

    const enBajasCaja = new Map<string, number>();
    for (const bc of formBajaCaja) {
        const valor = aCentavos(Math.abs(Number(bc.valor)));
        if (valor === 0) continue;
        const clave = `${Number(bc.caja_id ?? cajaMov)}|${Number(bc.moneda_id)}`;
        const signo = bc.naturaleza_financiera === 'Débito' ? 1 : -1;
        enBajasCaja.set(clave, (enBajasCaja.get(clave) ?? 0) + signo * valor);
    }

    const claves = new Set([...enAsientos.keys(), ...enBajasCaja.keys()]);
    for (const clave of claves) {
        const neto = enAsientos.get(clave) ?? 0;
        const esperado = enBajasCaja.get(clave) ?? 0;
        if (neto !== esperado) {
            throw new ErrorValidacionAsiento(
                `La caja no cuadra (caja|moneda ${clave}): asientos ${neto / 100} vs bajas de caja ${esperado / 100}`
            );
        }
    }
};

// ---------- GUARDAR (CREAR O ACTUALIZAR) ----------

export const guardarFinanciero = async (req: Request, res: Response) => {
    console.log('>>> guardarFinanciero llamado');
    console.log('>>> req.user:', (req as RequestWithUser).user);
    console.log('>>> req.body:', JSON.stringify(req.body, null, 2));

    const usuarioSesionId = (req as RequestWithUser).user?.id;
    if (!usuarioSesionId) {
        console.log('>>> Salida temprana: 401, no hay req.user.id');
        return res.status(401).json({ message: 'No autenticado' });
    }

    const { payload } = req.body ?? {};
    const formMovimiento = payload?.formMovimiento;
    const formBaja = payload?.formBaja;
    const formBajaCaja = payload?.formBajaCaja;

    if (!formMovimiento) {
        console.log('>>> Salida temprana: 400, falta formMovimiento');
        return res.status(400).json({ message: 'Falta formMovimiento' });
    }
    if (!Array.isArray(formBaja)) {
        console.log('>>> Salida temprana: 400, formBaja no es arreglo. Valor:', formBaja);
        return res.status(400).json({ message: 'formBaja debe ser un arreglo' });
    }

    console.log('>>> Validaciones iniciales OK. formBaja tiene', formBaja.length, 'líneas');

    // id = 0, null, undefined o "" => nuevo (INSERT)
    // id > 0 => actualización (UPDATE)
    const idRecibido = Number(formMovimiento.id) || 0;
    const esActualizacion = idRecibido > 0;
    const idActual = esActualizacion ? idRecibido : null;

    const client = await pool.connect();
    console.log('>>> Conexión obtenida del pool');

    try {
        await client.query('BEGIN');
        console.log('>>> BEGIN ejecutado');

        let movimientoId: number;

        if (esActualizacion) {
            // Un movimiento cancelado no se puede editar. Se bloquea la fila para evitar carreras.
            const { rows: actual } = await client.query(
                `SELECT estado FROM movimientos WHERE id = $1 FOR UPDATE`,
                [idActual]
            );

            if (actual.length === 0) {
                await client.query('ROLLBACK');
                console.log('>>> Movimiento no encontrado, ROLLBACK');
                return res.status(404).json({ message: 'Movimiento no encontrado' });
            }
            if (actual[0].estado === 'Cancelado') {
                await client.query('ROLLBACK');
                console.log('>>> Movimiento cancelado, no se puede editar');
                return res.status(400).json({ message: 'El movimiento está cancelado y no puede editarse' });
            }

            await client.query(
                `UPDATE movimientos
                 SET caja_id = $1,
                     fecha = $2,
                     usuario_id = $3,
                     observacion = $4,
                     moneda_id = $5
                 WHERE id = $6`,
                [
                    formMovimiento.caja_id,
                    formMovimiento.fecha,
                    formMovimiento.usuario_id,
                    formMovimiento.observacion,
                    formMovimiento.moneda_id,
                    idActual,
                ]
            );

            movimientoId = idActual!;
            console.log('>>> Movimiento actualizado, id:', movimientoId);

            // Bajas: siempre llega el arreglo completo, así que se reemplaza
            await client.query('DELETE FROM bajas WHERE movimiento_id = $1', [movimientoId]);
        } else {
            const insertResult = await client.query(
                `INSERT INTO movimientos (
                    caja_id, fecha, usuario_id, estado, observacion, moneda_id, tipo_movimiento
                 )
                 VALUES ($1, $2, $3, 'Efectivado', $4, $5, $6)
                 RETURNING id`,
                [
                    formMovimiento.caja_id,
                    formMovimiento.fecha,
                    formMovimiento.usuario_id,
                    formMovimiento.observacion,
                    formMovimiento.moneda_id,
                    formMovimiento.tipo_movimiento,
                ]
            );

            movimientoId = insertResult.rows[0].id;
            console.log('>>> Movimiento insertado, id:', movimientoId);
        }

        await insertarBajas(client, movimientoId, formBaja);
        console.log('>>> Bajas insertadas:', formBaja.length);

        // Bajas caja: solo se reemplazan si el front las envía (aunque sea []).
        if (Array.isArray(formBajaCaja)) {
            await client.query('DELETE FROM bajas_caja WHERE movimiento_id = $1', [movimientoId]);
            await insertarBajasCaja(client, movimientoId, formBajaCaja);
            console.log('>>> Bajas de caja insertadas:', formBajaCaja.length);
        }

        // Asientos: en edición se cancelan los anteriores (no se borran) y se crean los nuevos
        if (esActualizacion) {
            await cancelarAsientosDeMovimiento(
                movimientoId,
                usuarioSesionId,
                'Edición del movimiento',
                client
            );
            console.log('>>> Asientos anteriores cancelados');
        }

        const asientos = [
            ...construirAsientos(movimientoId, formMovimiento, formBaja, usuarioSesionId),
            ...construirAsientosCaja(movimientoId, formMovimiento, formBaja, formBajaCaja, usuarioSesionId),
        ];

        if (Array.isArray(formBajaCaja) && formBajaCaja.length > 0) {
            validarCajaContraBajasCaja(asientos, formBajaCaja, Number(formMovimiento.caja_id));
        }

        console.log('>>> asientos construidos:', JSON.stringify(asientos, null, 2));

        await insertarAsientos(asientos, client);
        console.log('>>> Asientos insertados:', asientos.length);

        await client.query('COMMIT');
        console.log('>>> COMMIT ejecutado, movimiento', movimientoId);

        return res.status(esActualizacion ? 200 : 201).json({
            message: esActualizacion ? 'Financiero actualizado!' : 'Financiero registrado!',
            id: movimientoId,
        });
    } catch (error) {
        console.error('>>> Error en guardarFinanciero:', error);
        await client.query('ROLLBACK');
        console.log('>>> ROLLBACK ejecutado');

        if (error instanceof ErrorValidacionAsiento) {
            console.log('>>> Respuesta 400 por validación:', error.message);
            return res.status(400).json({ message: error.message });
        }

        return res.status(500).json({
            message: esActualizacion
                ? 'Error al actualizar el financiero'
                : 'Error al registrar el financiero',
        });
    } finally {
        client.release();
        console.log('>>> Conexión liberada');
    }
};

// ---------- CANCELAR ----------

/**
 * Cancela un movimiento y todos sus asientos efectivados, en una sola transacción.
 * El movimiento y sus bajas se conservan para auditoría.
 * Body: { motivo: string }
 */
export const cancelarFinanciero = async (req: Request, res: Response) => {
    const usuarioId = (req as RequestWithUser).user?.id;
    if (!usuarioId) {
        return res.status(401).json({ message: 'No autenticado' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: 'ID inválido' });
    }

    const motivo = String(req.body?.motivo ?? '').trim();
    if (!motivo) {
        return res.status(400).json({ message: 'El motivo de cancelación es obligatorio' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT id, estado FROM movimientos WHERE id = $1 FOR UPDATE`,
            [id]
        );

        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Movimiento no encontrado' });
        }
        if (rows[0].estado === 'Cancelado') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'El movimiento ya está cancelado' });
        }

        await client.query(
            `UPDATE movimientos
             SET estado = 'Cancelado',
                 motivo_cancelado = $2
             WHERE id = $1`,
            [id, motivo]
        );

        // Cancela todos los asientos efectivados del movimiento (no los borra)
        await cancelarAsientosDeMovimiento(id, usuarioId, motivo, client);

        await client.query('COMMIT');

        return res.status(200).json({ message: 'Financiero cancelado', id });
    } catch (error) {
        console.error('>>> Error en cancelarFinanciero:', error);
        await client.query('ROLLBACK');

        if (error instanceof ErrorValidacionAsiento) {
            return res.status(400).json({ message: error.message });
        }

        return res.status(500).json({ message: 'Error al cancelar el financiero' });
    } finally {
        client.release();
    }
};

// ---------- OBTENER POR ID ----------

export const obtenerFinanciero = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ message: 'ID inválido' });
    }

    try {
        const result = await query(QUERY_POR_ID, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Movimiento no encontrado' });
        }

        return res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error al obtener el movimiento' });
    }
};

// ---------- LISTAR ----------

export const listarFinancieros = async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const cajaId = req.query.caja_id ? Number(req.query.caja_id) : null;

    try {
        const result = await query(QUERY_LISTADO, [limit, offset, cajaId]);

        return res.json({
            total: result.rows[0]?.total_registros ?? 0,
            data: result.rows.map(({ total_registros, ...row }) => row),
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error al listar los movimientos' });
    }
};