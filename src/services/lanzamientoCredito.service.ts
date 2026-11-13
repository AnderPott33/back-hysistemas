import { ErrorValidacionAsiento } from './asiento.service.js';

export const OPERACION_LANZAMIENTO_CREDITO = 'LANZAMIENTO_CREDITO';

/** Un lanzamiento de crédito de persona se identifica por su operación; no genera asientos de caja */
export const esLanzamientoCredito = (baja: any): boolean =>
    baja?.operacion === OPERACION_LANZAMIENTO_CREDITO;

const aDosDecimales = (n: number) => Math.round(n * 100) / 100;

/**
 * Convención de naturaleza hacia credito_persona_movimiento:
 * Débito de la línea -> Debito del crédito, Crédito de la línea -> Credito del crédito.
 * Saldo de la persona = SUM(Credito) - SUM(Debito).
 */
const naturalezaCredito = (naturalezaFront: string): 'Credito' | 'Debito' =>
    naturalezaFront === 'Débito' ? 'Debito' : 'Credito';

/** Marca como cancelados los créditos de persona de un movimiento (no los borra) */
export const cancelarCreditosDeMovimiento = async (client: any, movimientoId: number) => {
    await client.query(
        `UPDATE credito_persona_movimiento
         SET estado = 'Cancelado'
         WHERE movimiento_id = $1 AND estado = 'Efectivado'`,
        [movimientoId]
    );
};

/** Registra en credito_persona_movimiento cada lanzamiento del movimiento */
export const insertarCreditosDeLanzamientos = async (
    client: any,
    movimientoId: number,
    lineas: any[],
    usuarioId: number
) => {
    const sql = `
        INSERT INTO credito_persona_movimiento (
            grupo_id, persona_id, moneda_id, naturaleza, valor, cambio, valor_convertido,
            tipo, movimiento_id, observacion, creado_por
        )
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'LANZAMIENTO', $7, $8, $9)
    `;

    for (const [index, linea] of lineas.entries()) {
        const numero = index + 1;

        const personaId = Number(linea.persona_id);
        if (!personaId) {
            throw new ErrorValidacionAsiento(`El lanzamiento de crédito ${numero} no tiene persona`);
        }

        const valor = aDosDecimales(Math.abs(Number(linea.valor_liquido ?? linea.valor)));
        if (!(valor > 0)) {
            throw new ErrorValidacionAsiento(`El lanzamiento de crédito ${numero} tiene valor cero`);
        }

        const cambio = Number(linea.cambio);
        if (!(cambio > 0)) {
            throw new ErrorValidacionAsiento(
                `El lanzamiento de crédito ${numero} no tiene tipo de cambio hacia la moneda base`
            );
        }

        await client.query(sql, [
            personaId,
            Number(linea.moneda_id),
            naturalezaCredito(linea.naturaleza_financiera),
            valor,
            cambio,
            aDosDecimales(valor * cambio),
            movimientoId,
            linea.observacion?.trim() || linea.observacion_auto || null,
            usuarioId,
        ]);
    }
};
