import { Request, Response } from 'express';
import { query } from '../db/db.js';

type Naturaleza = 'Credito' | 'Debito';

interface LineaCredito {
    moneda_id: number;
    naturaleza: Naturaleza;
    valor: number;
    cambio: number;
    observacion?: string | null;
}

const esEntero = (v: unknown): v is number => Number.isInteger(Number(v)) && Number(v) > 0;
const aNumero = (v: unknown) => Number(v);
const redondear2 = (n: number) => Math.round(n * 100) / 100;

const SQL_SALDOS = `
    SELECT
        m.id AS moneda_id,
        m.codigo,
        m.nombre,
        m.simbolo,
        m.decimales,
        COALESCE(SUM(
            CASE WHEN c.naturaleza = 'Credito' THEN c.valor ELSE -c.valor END
        ), 0) AS saldo,
        COALESCE(SUM(
            CASE WHEN c.naturaleza = 'Credito' THEN c.valor_convertido ELSE -c.valor_convertido END
        ), 0) AS saldo_base
    FROM moneda m
    LEFT JOIN credito_persona_movimiento c
           ON c.moneda_id = m.id
          AND c.persona_id = $1::int8
          AND c.estado = 'Efectivado'
    WHERE m.activo = true
    GROUP BY m.id, m.codigo, m.nombre, m.simbolo, m.decimales
    ORDER BY m.id
`;

const SQL_LIMITE = `
    SELECT p.id, p.nombre, p.limite_credito
    FROM persona p
    WHERE p.id = $1::int8
`;

/** GET /api/personas/:id/credito */
export const obtenerCreditoPersona = async (req: Request, res: Response) => {
    const personaId = Number(req.params.id);
    if (!esEntero(personaId)) {
        return res.status(400).json({ error: 'El id de la persona no es válido' });
    }

    try {
        const persona = await query(SQL_LIMITE, [personaId]);
        if (!persona.rows[0]) {
            return res.status(404).json({ error: 'Persona no encontrada' });
        }

        const saldos = await query(SQL_SALDOS, [personaId]);

        // Deuda de la persona hacia nosotros, en moneda base (positivo = la persona debe)
        const saldoBase = saldos.rows.reduce((acc, s) => acc + aNumero(s.saldo_base), 0);
        const deudaCliente = redondear2(-saldoBase);
        const limite = aNumero(persona.rows[0].limite_credito ?? 0);

        return res.status(200).json({
            persona_id: personaId,
            limite_credito: limite,
            deuda_base: deudaCliente,
            bloqueado: limite > 0 && deudaCliente > limite,
            saldos: saldos.rows.map(s => ({
                moneda_id: Number(s.moneda_id),
                codigo: s.codigo,
                nombre: s.nombre,
                simbolo: s.simbolo,
                decimales: Number(s.decimales),
                saldo: aNumero(s.saldo),
            })),
        });
    } catch (error) {
        console.error('Error en obtenerCreditoPersona:', error);
        return res.status(500).json({ error: 'No se pudo obtener el crédito de la persona' });
    }
};

const SQL_INSERTAR_LINEAS = `
    INSERT INTO credito_persona_movimiento
        (grupo_id, persona_id, moneda_id, naturaleza, valor, cambio, valor_convertido,
         tipo, movimiento_id, observacion, creado_por)
    SELECT
        $1::uuid, $2::int8, t.moneda_id, t.naturaleza, t.valor, t.cambio, t.valor_convertido,
        $3::varchar, $4::int8, t.observacion, $5::int4
    FROM unnest(
        $6::int4[], $7::varchar[], $8::numeric[], $9::numeric[], $10::numeric[], $11::text[]
    ) AS t(moneda_id, naturaleza, valor, cambio, valor_convertido, observacion)
    RETURNING id
`;

/**
 * POST /api/personas/:id/credito
 * Body: { grupo_id?, tipo?, movimiento_id?, lineas: LineaCredito[] }
 * Todas las líneas se insertan en una sola sentencia, así que son atómicas.
 */
export const registrarCreditoPersona = async (req: Request, res: Response) => {
    const personaId = Number(req.params.id);
    const { grupo_id, tipo, movimiento_id, lineas } = req.body ?? {};
    const usuarioId = Number((req as any).user?.id ?? (req as any).usuario?.id);

    if (!esEntero(personaId)) {
        return res.status(400).json({ error: 'El id de la persona no es válido' });
    }
    if (!Array.isArray(lineas) || lineas.length === 0) {
        return res.status(400).json({ error: 'Debe enviar al menos una línea' });
    }
    if (!esEntero(usuarioId)) {
        return res.status(401).json({ error: 'Usuario no identificado' });
    }

    const lineasValidas: { moneda_id: number; naturaleza: Naturaleza; valor: number; cambio: number; valor_convertido: number; observacion: string | null }[] = [];

    for (const l of lineas as LineaCredito[]) {
        const valor = aNumero(l.valor);
        const cambio = aNumero(l.cambio);
        if (!esEntero(l.moneda_id)) {
            return res.status(400).json({ error: 'Cada línea debe tener moneda_id válido' });
        }
        if (l.naturaleza !== 'Credito' && l.naturaleza !== 'Debito') {
            return res.status(400).json({ error: 'naturaleza debe ser Credito o Debito' });
        }
        if (!(valor > 0)) {
            return res.status(400).json({ error: 'Cada valor debe ser mayor a cero' });
        }
        if (!(cambio > 0)) {
            return res.status(400).json({ error: 'Falta el tipo de cambio hacia la moneda base' });
        }
        lineasValidas.push({
            moneda_id: Number(l.moneda_id),
            naturaleza: l.naturaleza,
            valor,
            cambio,
            valor_convertido: redondear2(valor * cambio),
            observacion: l.observacion?.trim() || null,
        });
    }

    try {
        // Control de límite: la deuda resultante no puede superar el límite
        const persona = await query(SQL_LIMITE, [personaId]);
        if (!persona.rows[0]) {
            return res.status(404).json({ error: 'Persona no encontrada' });
        }
        const limite = aNumero(persona.rows[0].limite_credito ?? 0);

        const saldos = await query(SQL_SALDOS, [personaId]);
        const saldoBaseActual = saldos.rows.reduce((acc, s) => acc + aNumero(s.saldo_base), 0);
        const deltaBase = lineasValidas.reduce(
            (acc, l) => acc + (l.naturaleza === 'Credito' ? -l.valor_convertido : l.valor_convertido),
            0
        );
        const deudaResultante = redondear2(-(saldoBaseActual + deltaBase));

        // Regla a confirmar: solo se valida si la operación aumenta lo que la persona debe
        if (limite > 0 && deudaResultante > limite && deltaBase > 0) {
            return res.status(400).json({
                error: `La operación supera el límite de crédito (${limite.toLocaleString('es-PY')})`,
            });
        }

        const grupo = typeof grupo_id === 'string' && /^[0-9a-f-]{36}$/i.test(grupo_id)
            ? grupo_id
            : null;

        const result = await query(SQL_INSERTAR_LINEAS, [
            grupo ?? '00000000-0000-0000-0000-000000000000',
            personaId,
            String(tipo ?? 'AJUSTE'),
            esEntero(movimiento_id) ? Number(movimiento_id) : null,
            usuarioId,
            lineasValidas.map(l => l.moneda_id),
            lineasValidas.map(l => l.naturaleza),
            lineasValidas.map(l => l.valor),
            lineasValidas.map(l => l.cambio),
            lineasValidas.map(l => l.valor_convertido),
            lineasValidas.map(l => l.observacion),
        ]);

        return res.status(201).json({
            mensaje: 'Movimiento de crédito registrado',
            ids: result.rows.map(r => Number(r.id)),
        });
    } catch (error) {
        console.error('Error en registrarCreditoPersona:', error);
        return res.status(500).json({ error: 'No se pudo registrar el movimiento de crédito' });
    }
};