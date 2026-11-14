import { Request, Response } from 'express';
import { query } from '../db/db.js';
import { generatePdfService } from '../services/pdfService.js';

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES COMPARTIDAS
// ═══════════════════════════════════════════════════════════════════════════
const esVacio = (valor: unknown) => valor === undefined || valor === null || valor === '';

const aEntero = (valor: unknown): number | null | undefined => {
    if (esVacio(valor)) return null;
    const n = Number(valor);
    if (!Number.isInteger(n)) return undefined;
    return n > 0 ? n : null;
};

const formatear = (valor: number, decimales = 0) =>
    new Intl.NumberFormat('de-DE', {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales,
    }).format(valor);

const REGEX_FECHA = /^(\d{4})[-/](\d{2})[-/](\d{2})$/;

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

// ═══════════════════════════════════════════════════════════════════════════
// 1. SALDOS POR SUBCATEGORÍA
// ═══════════════════════════════════════════════════════════════════════════
const TIPOS_SUBCATEGORIA = ['Ingreso', 'Gasto'];

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

            caja_id: cajaId ? `${cajaId}-` : '',
            caja_nombre: cajaId ? resultCaja.rows[0]?.descripcion ?? '—' : 'Todas',
            cuenta_id: cuentaId ? `${cuentaId}-` : '',
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

// ═══════════════════════════════════════════════════════════════════════════
// 2. DRE MENSUAL (OCURRIDO)
// Siempre en moneda base de la empresa: se usa asiento.valor_contable.
// Grupos = public.categoria (codigo para ordenar y etiquetar, tipo para el bloque).
// Cuentas = subcategorías con movimiento en el año.
// Totalizadores: Total Ingresos, Total Gastos y Resultado Neto.
// ═══════════════════════════════════════════════════════════════════════════

type Tipo = 'Ingreso' | 'Gasto';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const N = 12;

type Valor = number | null;

type CategoriaSQL = {
    id: number;
    codigo: string | null;
    nombre: string;
    tipo: Tipo;
};

const SQL_CATEGORIAS = `
SELECT id, codigo, nombre, tipo
FROM public.categoria
WHERE activo = true`;

type FilaDRESQL = {
    tipo: Tipo;
    categoria_id: number;
    subcategoria_id: number;
    subcategoria_nombre: string;
    mes: number;
    neto: string | number;
};

// Saldo ocurrido por subcategoría y mes en moneda base (valor_contable).
// neto = Débito − Crédito (misma convención que saldos por subcategoría).
// $1 anio, $2 sucursal_id (o null)
const SQL_DRE_MENSUAL = `
WITH base AS (
    SELECT
        a.tipo_asiento,
        a.subcategoria_id,
        a.naturaleza,
        REPLACE(a.fecha_contable::text, '/', '-')::date AS fecha,
        a.valor_contable AS importe
    FROM public.asiento a
    WHERE a.estado = 'Efectivado'
      AND a.tipo_asiento IN ('PAGO', 'RECIBIMIENTO')
      AND a.subcategoria_id IS NOT NULL
      AND ($2::int IS NULL OR a.sucursal_id = $2::int)
),
unidos AS (
    SELECT
        CASE WHEN b.tipo_asiento = 'RECIBIMIENTO' THEN 'Ingreso' ELSE 'Gasto' END::text AS tipo,
        COALESCE(si.categoria_id, sg.categoria_id) AS categoria_id,
        b.subcategoria_id,
        COALESCE(si.nombre, sg.nombre) AS subcategoria_nombre,
        EXTRACT(MONTH FROM b.fecha)::int AS mes,
        CASE WHEN b.naturaleza = 'Débito' THEN b.importe ELSE -b.importe END AS neto
    FROM base b
    LEFT JOIN public.subcategoria_ingreso si
           ON b.tipo_asiento = 'RECIBIMIENTO' AND si.id = b.subcategoria_id
    LEFT JOIN public.subcategoria_gasto sg
           ON b.tipo_asiento = 'PAGO' AND sg.id = b.subcategoria_id
    WHERE EXTRACT(YEAR FROM b.fecha) = $1::int
)
SELECT
    tipo,
    categoria_id,
    subcategoria_id,
    subcategoria_nombre,
    mes,
    COALESCE(SUM(neto), 0) AS neto
FROM unidos
WHERE categoria_id IS NOT NULL
GROUP BY tipo, categoria_id, subcategoria_id, subcategoria_nombre, mes`;

// Moneda base de la empresa: el DRE siempre se presenta en esta moneda.
const SQL_EMPRESA_BASE = `
SELECT e.fantasia, e.ruc, e.direccion, e.telefono, m.codigo AS moneda_codigo
FROM public.empresa e
LEFT JOIN public.moneda m ON m.id = e.moneda_base
WHERE e.activo = true
ORDER BY e.id
LIMIT 1`;

// ─── Utilidades del DRE ────────────────────────────────────────────────────
// Negativos entre paréntesis; sin movimiento: "-".
const fmtValor = (v: Valor) => {
    if (v === null) return '-';
    return v < 0 ? `(${formatear(Math.abs(v))})` : formatear(v);
};

const fmtPct = (v: Valor) => (v === null ? '-' : `${formatear(v, 1)}%`);

// AV: línea sobre Total Ingresos del mismo mes.
const analisisVertical = (valor: Valor, base: Valor): Valor =>
    valor === null || base === null || base === 0 ? null : (valor / base) * 100;

// AH: (mes − mes anterior) ÷ |mes anterior|. Sin base (anterior nulo o cero) → null.
const analisisHorizontal = (cur: Valor, prev: Valor): Valor =>
    cur === null || prev === null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;

// Suma anual: null si el año no tiene ningún movimiento en la línea.
const sumaAnual = (valores: Valor[]): Valor =>
    valores.some((v) => v !== null) ? valores.reduce<number>((s, v) => s + (v ?? 0), 0) : null;

// ─── Cálculo del DRE ────────────────────────────────────────────────────────
type FilaDRE = { clase: string; nombre: string; valores: Valor[] };

const ordenarCodigo = (a: string | null, b: string | null) =>
    (a ?? '').localeCompare(b ?? '', 'es', { numeric: true });

const calcularDRE = (categorias: CategoriaSQL[], filas: FilaDRESQL[]) => {
    const hayMovimiento: boolean[] = Array(N).fill(false);

    // Serie mensual por subcategoría, con la categoría a la que pertenece.
    const subcategorias = new Map<string, { categoria_id: number; tipo: Tipo; nombre: string; serie: Valor[] }>();
    for (const f of filas) {
        const i = f.mes - 1;
        hayMovimiento[i] = true;
        const clave = `${f.tipo}|${f.categoria_id}|${f.subcategoria_id}`;
        const sub = subcategorias.get(clave) ?? {
            categoria_id: f.categoria_id,
            tipo: f.tipo,
            nombre: f.subcategoria_nombre,
            serie: Array(N).fill(null) as Valor[],
        };
        sub.serie[i] = (sub.serie[i] ?? 0) + Number(f.neto);
        subcategorias.set(clave, sub);
    }

    const salida: FilaDRE[] = [];

    // Recorre las categorías de un tipo y devuelve el total mensual de ese tipo.
    const bloque = (tipo: Tipo): Valor[] => {
        const total: Valor[] = Array(N).fill(null);

        const cats = categorias
            .filter((c) => c.tipo === tipo)
            .sort((a, b) => ordenarCodigo(a.codigo, b.codigo));

        for (const cat of cats) {
            const hijos = [...subcategorias.values()]
                .filter((s) => s.tipo === tipo && s.categoria_id === cat.id)
                .filter((s) => s.serie.some((v) => v !== null))
                .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));

            if (hijos.length === 0) continue;

            const valoresCat = Array.from({ length: N }, (_, i) =>
                hijos.some((h) => h.serie[i] !== null)
                    ? hijos.reduce<number>((acc, h) => acc + (h.serie[i] ?? 0), 0)
                    : null,
            );

            salida.push({
                clase: 'fila-grupo',
                nombre: cat.codigo ? `${cat.codigo} ${cat.nombre}` : cat.nombre,
                valores: valoresCat,
            });
            hijos.forEach((h) => salida.push({ clase: 'fila-cuenta', nombre: h.nombre, valores: h.serie }));

            valoresCat.forEach((v, i) => {
                if (v !== null) total[i] = (total[i] ?? 0) + v;
            });
        }

        // Total del tipo: "-" si el mes no tiene movimiento; sin movimiento propio = 0.
        return Array.from({ length: N }, (_, i) => (hayMovimiento[i] ? (total[i] ?? 0) : null));
    };

    const ingresos = bloque('Ingreso');
    salida.push({ clase: 'fila-total', nombre: 'Total Ingresos', valores: ingresos });

    const gastos = bloque('Gasto');
    salida.push({ clase: 'fila-total', nombre: 'Total Gastos', valores: gastos });

    const resultado = Array.from({ length: N }, (_, i) =>
        hayMovimiento[i] ? (ingresos[i] ?? 0) + (gastos[i] ?? 0) : null,
    );
    salida.push({ clase: 'fila-total', nombre: 'Resultado Neto', valores: resultado });

    return { filas: salida, ingresos };
};

// ─── Controlador ────────────────────────────────────────────────────────────
export const dreMensual = async (req: Request, res: Response) => {
    const { sucursal_id, anio } = req.body ?? {};

    const sucursalId = aEntero(sucursal_id);
    const anioN = aEntero(anio);

    if (sucursalId === undefined) {
        return res.status(400).json({ error: 'sucursal_id debe ser entero o null' });
    }
    if (!anioN || anioN < 2000 || anioN > 2100) {
        return res.status(400).json({ error: 'anio es obligatorio (entre 2000 y 2100)' });
    }

    try {
        const [resultCategorias, resultFilas, resultEmpresa] = await Promise.all([
            query(SQL_CATEGORIAS),
            query(SQL_DRE_MENSUAL, [anioN, sucursalId]),
            query(SQL_EMPRESA_BASE),
        ]);

        const { filas, ingresos } = calcularDRE(
            resultCategorias.rows as CategoriaSQL[],
            resultFilas.rows as FilaDRESQL[],
        );
        const ingresosAnual = sumaAnual(ingresos);

        const filasVista = filas.map((f) => {
            const acumulado = sumaAnual(f.valores);
            return {
                clase: f.clase,
                nombre: f.nombre,
                celdas: f.valores.map((v, i) => ({
                    valor_f: fmtValor(v),
                    av_f: fmtPct(analisisVertical(v, ingresos[i])),
                    ah_f: fmtPct(i === 0 ? null : analisisHorizontal(v, f.valores[i - 1])),
                })),
                acumulado: {
                    valor_f: fmtValor(acumulado),
                    av_f: fmtPct(analisisVertical(acumulado, ingresosAnual)),
                },
            };
        });

        const empresa = resultEmpresa.rows[0];

        const datos = {
            titulo_documento: `Estado de Resultados (DRE) · Ocurrido · ${anioN}`,
            empresa_nombre: empresa?.fantasia ?? '',
            otrosDatosEmpresa: [
                empresa?.ruc ? `RUC ${empresa.ruc}` : null,
                empresa?.direccion,
                empresa?.telefono,
            ].filter(Boolean).join(' · '),

            anio: anioN,
            sucursal_nombre: 'Todas',
            moneda_codigo: empresa?.moneda_codigo ?? '—',

            usuario: (req as any).user?.nombre ?? '—',
            fecha_generacion_f: new Intl.DateTimeFormat('es-PY', {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: 'America/Asuncion',
            }).format(new Date()),

            meses: MESES,
            filas: filasVista,
        };

        const pdf = await generatePdfService('dre', datos);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="dre.pdf"');
        return res.status(200).send(pdf);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'No se pudo generar el DRE mensual' });
    }
};