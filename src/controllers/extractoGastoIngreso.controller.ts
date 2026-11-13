import { Request, Response } from 'express';
import { query } from '../db/db.js';
import { generatePdfService } from '../services/pdfService.js';

const TIPOS_SUBCATEGORIA = ['Ingreso', 'Gasto'];
const REGEX_FECHA = /^(\d{4})[-/](\d{2})[-/](\d{2})$/;

const esVacio = (valor: unknown) => valor === undefined || valor === null || valor === '';

const aEntero = (valor: unknown): number | null | undefined => {
    if (esVacio(valor)) return null;
    const n = Number(valor);
    if (!Number.isInteger(n)) return undefined;
    return n > 0 ? n : null;
};

// Acepta YYYY-MM-DD o YYYY/MM/DD y devuelve siempre YYYY-MM-DD.
const aFecha = (valor: unknown): string | null | undefined => {
    if (esVacio(valor)) return null;
    if (typeof valor !== 'string') return undefined;
    const match = valor.trim().match(REGEX_FECHA);
    if (!match) return undefined;

    const [, anio, mes, dia] = match;
    const normalizada = `${anio}-${mes}-${dia}`;
    const fecha = new Date(`${normalizada}T00:00:00Z`);
    if (isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== normalizada) return undefined;

    return normalizada;
};

const aBooleano = (valor: unknown): boolean | undefined => {
    if (esVacio(valor)) return true;
    if (typeof valor === 'boolean') return valor;
    if (valor === 'true') return true;
    if (valor === 'false') return false;
    return undefined;
};

// Saldos por subcategoría (ingreso y gasto), con saldo anterior, movimientos del periodo y saldo final.
// Parámetros:
// $1 caja_id, $2 cuenta_id, $3 moneda_id, $4 tipo ('Ingreso' | 'Gasto' | null),
// $5 desde (timestamp o null), $6 hasta (timestamp o null), $7 consolidado (boolean)
const SQL_SALDOS_SUBCATEGORIA = `
WITH base AS (
    SELECT
        a.id,
        a.tipo_asiento,
        a.subcategoria_id,
        a.naturaleza,
        REPLACE(a.fecha_contable::text, '/', '-')::timestamp AS fecha_ts,
        CASE WHEN a.caja_id IS NULL THEN COALESCE(a.valor_convertido, a.valor) ELSE a.valor END AS importe,
        CASE WHEN a.caja_id IS NULL THEN c.moneda_id ELSE a.moneda_id END AS moneda_efectiva
    FROM public.asiento a
    LEFT JOIN public.cuenta c ON c.id = a.cuenta_id
    WHERE a.estado = 'Efectivado'
      AND a.tipo_asiento IN ('PAGO', 'RECIBIMIENTO')
      AND a.subcategoria_id IS NOT NULL
      AND ($1::int IS NULL OR a.caja_id   = $1::int)
      AND ($2::int IS NULL OR a.cuenta_id = $2::int)
),
unidos AS (
    SELECT
        CASE WHEN b.tipo_asiento = 'RECIBIMIENTO' THEN 'Ingreso' ELSE 'Gasto' END::text AS tipo,
        b.subcategoria_id,
        COALESCE(si.categoria_id, sg.categoria_id) AS categoria_id,
        cat.nombre AS categoria_nombre,
        COALESCE(si.nombre, sg.nombre) AS subcategoria_nombre,
        b.moneda_efectiva AS moneda_id,
        b.fecha_ts AS fecha,
        CASE WHEN b.naturaleza = 'Débito'  THEN b.importe ELSE NULL END AS entrada,
        CASE WHEN b.naturaleza = 'Crédito' THEN b.importe ELSE NULL END AS salida,
        CASE WHEN b.naturaleza = 'Débito'  THEN b.importe ELSE -b.importe END AS neto
    FROM base b
    LEFT JOIN public.subcategoria_ingreso si
           ON b.tipo_asiento = 'RECIBIMIENTO' AND si.id = b.subcategoria_id
    LEFT JOIN public.subcategoria_gasto sg
           ON b.tipo_asiento = 'PAGO' AND sg.id = b.subcategoria_id
    LEFT JOIN public.categoria cat
           ON cat.id = COALESCE(si.categoria_id, sg.categoria_id)
    WHERE ($3::int IS NULL OR b.moneda_efectiva = $3::int)
      AND ($4::text IS NULL OR
           (CASE WHEN b.tipo_asiento = 'RECIBIMIENTO' THEN 'Ingreso' ELSE 'Gasto' END) = $4::text)
),
previo AS (
    SELECT tipo, subcategoria_id, moneda_id,
           COALESCE(SUM(neto), 0) AS saldo_previo
    FROM unidos
    WHERE $5::timestamp IS NOT NULL
      AND fecha < $5::timestamp
    GROUP BY tipo, subcategoria_id, moneda_id
),
periodo AS (
    SELECT *
    FROM unidos
    WHERE ($5::timestamp IS NULL OR fecha >= $5::timestamp)
      AND ($6::timestamp IS NULL OR fecha <= $6::timestamp)
),
por_periodo AS (
    SELECT tipo, subcategoria_id, moneda_id,
           COALESCE(SUM(entrada), 0) AS total_entrada,
           COALESCE(SUM(salida), 0)  AS total_salida,
           COALESCE(SUM(neto), 0)    AS neto_periodo
    FROM periodo
    GROUP BY tipo, subcategoria_id, moneda_id
),
claves AS (
    SELECT DISTINCT tipo, categoria_id, categoria_nombre,
                    subcategoria_id, subcategoria_nombre, moneda_id
    FROM unidos
    WHERE $6::timestamp IS NULL OR fecha <= $6::timestamp
)
SELECT
    k.tipo,
    k.categoria_id,
    k.categoria_nombre,
    k.subcategoria_id,
    k.subcategoria_nombre,
    k.moneda_id,
    COALESCE(pr.saldo_previo, 0)  AS saldo_anterior,
    COALESCE(pp.total_entrada, 0) AS total_entrada,
    COALESCE(pp.total_salida, 0)  AS total_salida,
    (CASE WHEN $7::boolean THEN COALESCE(pr.saldo_previo, 0) ELSE 0 END)
      + COALESCE(pp.neto_periodo, 0) AS saldo_final
FROM claves k
LEFT JOIN previo pr
       ON pr.tipo = k.tipo
      AND pr.subcategoria_id = k.subcategoria_id
      AND pr.moneda_id = k.moneda_id
LEFT JOIN por_periodo pp
       ON pp.tipo = k.tipo
      AND pp.subcategoria_id = k.subcategoria_id
      AND pp.moneda_id = k.moneda_id
ORDER BY k.tipo, k.categoria_nombre, k.subcategoria_nombre, k.moneda_id`;

type FilaSQL = {
    tipo: string;
    categoria_id: number;
    categoria_nombre: string;
    subcategoria_id: number;
    subcategoria_nombre: string;
    moneda_id: number;
    saldo_anterior: string | number;
    total_entrada: string | number;
    total_salida: string | number;
    saldo_final: string | number;
};

type ResumenMoneda = {
    moneda_id: number;
    saldo_anterior: number;
    total_entrada: number;
    total_salida: number;
    saldo_final: number;
};

type MonedaRow = {
    id: number;
    codigo: string;
    simbolo: string;
    decimales: number | null;
};

// Suma una fila en la lista de montos por moneda, creando la entrada si no existe.
const acumularPorMoneda = (lista: ResumenMoneda[], f: FilaSQL) => {
    let r = lista.find((x) => x.moneda_id === f.moneda_id);
    if (!r) {
        r = { moneda_id: f.moneda_id, saldo_anterior: 0, total_entrada: 0, total_salida: 0, saldo_final: 0 };
        lista.push(r);
    }
    r.saldo_anterior += Number(f.saldo_anterior);
    r.total_entrada += Number(f.total_entrada);
    r.total_salida += Number(f.total_salida);
    r.saldo_final += Number(f.saldo_final);
};

// Arma la estructura: categorías -> totales por moneda y subcategorías -> montos por moneda.
const agruparPorCategoria = (filas: FilaSQL[]) => {
    const categorias = new Map<number, any>();

    for (const f of filas) {
        if (!categorias.has(f.categoria_id)) {
            categorias.set(f.categoria_id, {
                categoria_id: f.categoria_id,
                categoria_nombre: f.categoria_nombre,
                tipo: f.tipo,
                totales_por_moneda: [] as ResumenMoneda[],
                subcategorias: new Map<number, any>(),
            });
        }
        const cat = categorias.get(f.categoria_id);
        acumularPorMoneda(cat.totales_por_moneda, f);

        if (!cat.subcategorias.has(f.subcategoria_id)) {
            cat.subcategorias.set(f.subcategoria_id, {
                subcategoria_id: f.subcategoria_id,
                subcategoria_nombre: f.subcategoria_nombre,
                monedas: [] as ResumenMoneda[],
            });
        }
        acumularPorMoneda(cat.subcategorias.get(f.subcategoria_id).monedas, f);
    }

    return [...categorias.values()].map((c) => ({
        ...c,
        subcategorias: [...c.subcategorias.values()],
    }));
};

// Formato de montos con separador de miles (1.250.000), igual que el recibo.
const formatear = (valor: number, decimales = 0) =>
    new Intl.NumberFormat('de-DE', {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales,
    }).format(valor);

// Convierte YYYY-MM-DD en DD/MM/YYYY para mostrar en el informe.
const fechaLarga = (fecha: string | null) => (fecha ? fecha.split('-').reverse().join('/') : '—');

// Agrega los campos de texto que usa la plantilla a un resumen por moneda.
const aVistaMonto = (r: ResumenMoneda, monedas: Map<number, MonedaRow>) => {
    const m = monedas.get(r.moneda_id);
    const decimales = m?.decimales ?? 2;
    return {
        ...r,
        moneda_codigo: m?.codigo ?? String(r.moneda_id),
        simbolo_moneda: m?.simbolo ?? '',
        saldo_anterior_f: formatear(r.saldo_anterior, decimales),
        total_entrada_f: formatear(r.total_entrada, decimales),
        total_salida_f: formatear(r.total_salida, decimales),
        saldo_final_f: formatear(r.saldo_final, decimales),
    };
};

const vacio = { rows: [] as any[] };

export const saldosSubcategorias = async (req: Request, res: Response) => {
    const { caja_id, cuenta_id, moneda_id, tipo, fecha_inicio, fecha_fin, consolidado } = req.body ?? {};

    const cajaId = aEntero(caja_id);
    const cuentaId = aEntero(cuenta_id);
    const monedaId = aEntero(moneda_id);
    const fechaInicio = aFecha(fecha_inicio);
    const fechaFin = aFecha(fecha_fin);
    const incluirAnterior = aBooleano(consolidado);

    if (cajaId === undefined || cuentaId === undefined || monedaId === undefined) {
        return res.status(400).json({ error: 'caja_id, cuenta_id y moneda_id deben ser enteros o null' });
    }
    if (fechaInicio === undefined || fechaFin === undefined) {
        return res.status(400).json({ error: 'fecha_inicio y fecha_fin deben tener formato YYYY-MM-DD o YYYY/MM/DD, o ser null' });
    }
    if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
        return res.status(400).json({ error: 'fecha_inicio no puede ser mayor a fecha_fin' });
    }

    const tipoFiltro = esVacio(tipo) ? null : tipo;
    if (tipoFiltro !== null && (typeof tipoFiltro !== 'string' || !TIPOS_SUBCATEGORIA.includes(tipoFiltro))) {
        return res.status(400).json({ error: `tipo debe ser uno de: ${TIPOS_SUBCATEGORIA.join(', ')} o null` });
    }
    if (incluirAnterior === undefined) {
        return res.status(400).json({ error: 'consolidado debe ser boolean o null' });
    }

    const desde = fechaInicio ? `${fechaInicio} 00:00:00` : null;
    const hasta = fechaFin ? `${fechaFin} 23:59:59.999999` : null;

    try {
        const [resultSubcat, resultMonedas, resultCaja, resultCuenta, resultEmpresa] = await Promise.all([
            query(SQL_SALDOS_SUBCATEGORIA, [
                cajaId,
                cuentaId,
                monedaId,
                tipoFiltro,
                desde,
                hasta,
                incluirAnterior,
            ]),
            query('SELECT id, codigo, simbolo, decimales FROM public.moneda'),
            cajaId ? query('SELECT descripcion FROM public.cajas WHERE id = $1', [cajaId]) : Promise.resolve(vacio),
            cuentaId ? query('SELECT nombre FROM public.cuenta WHERE id = $1', [cuentaId]) : Promise.resolve(vacio),
            query('SELECT fantasia, ruc, direccion, telefono FROM public.empresa WHERE activo = true ORDER BY id LIMIT 1'),
        ]);

        const filas = resultSubcat.rows as FilaSQL[];
        const monedas = resultMonedas.rows as MonedaRow[];
        const mapaMonedas = new Map<number, MonedaRow>(monedas.map((m) => [m.id, m]));
        const empresa = resultEmpresa.rows[0];

        const categorias = agruparPorCategoria(filas).map((c) => ({
            categoria_id: c.categoria_id,
            categoria_nombre: c.categoria_nombre,
            tipo: c.tipo,
            totales_por_moneda: c.totales_por_moneda.map((r: ResumenMoneda) => aVistaMonto(r, mapaMonedas)),
            subcategorias: c.subcategorias.map((s: any) => ({
                subcategoria_id: s.subcategoria_id,
                subcategoria_nombre: s.subcategoria_nombre,
                monedas: s.monedas.map((r: ResumenMoneda) => aVistaMonto(r, mapaMonedas)),
            })),
        }));

        const totalesGenerales: ResumenMoneda[] = [];
        for (const f of filas) acumularPorMoneda(totalesGenerales, f);

        const datos = {
            titulo_documento: 'Saldos por subcategoría',
            empresa_nombre: empresa?.fantasia ?? '',
            otrosDatosEmpresa: [
                empresa?.ruc ? `RUC ${empresa.ruc}` : null,
                empresa?.direccion,
                empresa?.telefono,
            ].filter(Boolean).join(' · '),

            periodo_inicio_f: fechaLarga(fechaInicio ?? null),
            periodo_fin_f: fechaLarga(fechaFin ?? null),

            caja_nombre: cajaId ? resultCaja.rows[0]?.descripcion ?? '—' : 'Todas',
            cuenta_nombre: cuentaId ? resultCuenta.rows[0]?.nombre ?? '—' : 'Todas',
            moneda_filtro: monedaId ? mapaMonedas.get(monedaId)?.codigo ?? '—' : 'Todas',
            tipo_filtro: tipoFiltro ?? 'Todos',
            consolidado: incluirAnterior,

            usuario: (req as any).user?.nombre ?? '—',
            fecha_generacion_f: new Intl.DateTimeFormat('es-PY', {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: 'America/Asuncion',
            }).format(new Date()),

            totales_generales: totalesGenerales.map((r) => aVistaMonto(r, mapaMonedas)),
            categorias,
        };

        const pdf = await generatePdfService('crmInforme', datos);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="crmInforme.pdf"');
        return res.status(200).send(pdf);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'No se pudo generar el informe de saldos por subcategoría' });
    }
};