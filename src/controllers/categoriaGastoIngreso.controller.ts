import { Request, Response } from 'express';
import { query } from '../db/db.js';

type TipoCategoria = 'Ingreso' | 'Gasto';
const TIPOS_CATEGORIA: TipoCategoria[] = ['Ingreso', 'Gasto'];

// Cada tipo de categoría tiene su propia tabla de subcategorías.
// Los nombres salen de este mapa fijo (nunca del input del usuario), así que son seguros dentro del SQL.
const TABLA_SUBCATEGORIA: Record<TipoCategoria, string> = {
    Ingreso: 'subcategoria_ingreso',
    Gasto: 'subcategoria_gasto',
};

// Columna de la tabla movimiento que referencia cada tabla de subcategorías.
// VERIFICAR: ajustar estos nombres al esquema real de movimiento.
const COLUMNA_MOVIMIENTO: Record<TipoCategoria, string> = {
    Ingreso: 'subcategoria_ingreso_id',
    Gasto: 'subcategoria_gasto_id',
};

// Los ids se repiten entre ambas tablas, por eso las consultas por id siempre necesitan el tipo.
const SUBCATEGORIAS_UNIFICADAS = `
    SELECT id, codigo, nombre, descripcion, activo, categoria_id, creado_en, actualizado_en
    FROM subcategoria_ingreso
    UNION ALL
    SELECT id, codigo, nombre, descripcion, activo, categoria_id, creado_en, actualizado_en
    FROM subcategoria_gasto
`;

const esTipo = (valor: unknown): valor is TipoCategoria =>
    typeof valor === 'string' && (TIPOS_CATEGORIA as string[]).includes(valor);

const limpiar = (valor: unknown): string | null =>
    typeof valor === 'string' && valor.trim() ? valor.trim() : null;

const contarSubcategoriasDeCategoria = async (categoriaId: number): Promise<number> => {
    const result = await query(`
        SELECT (
            (SELECT COUNT(*) FROM subcategoria_ingreso WHERE categoria_id = $1) +
            (SELECT COUNT(*) FROM subcategoria_gasto WHERE categoria_id = $1)
        )::int AS total
    `, [categoriaId]);
    return result.rows[0].total;
};

const contarMovimientosDeSubcategoria = async (tipo: TipoCategoria, subcategoriaId: number): Promise<number> => {
    const result = await query(
        `SELECT COUNT(*)::int AS total FROM movimiento WHERE ${COLUMNA_MOVIMIENTO[tipo]} = $1`,
        [subcategoriaId]
    );
    return result.rows[0].total;
};

// =========================================
// CATEGORÍAS
// =========================================

export const ListarCategorias = async (req: Request, res: Response) => {
    try {
        const result = await query(`
            SELECT id, codigo, nombre, tipo, activo, creado_en, actualizado_en
            FROM categoria
            ORDER BY tipo ASC, nombre ASC
        `);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "No se pudieron cargar las categorías" });
    }
};

export const ListarCategoriaId = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await query(`
            SELECT id, codigo, nombre, tipo, activo, creado_en, actualizado_en
            FROM categoria
            WHERE id = $1
        `, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Categoría no encontrada" });
        }
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "No se pudo cargar la categoría" });
    }
};

export const ActualizarCategoria = async (req: Request, res: Response) => {
    const { id, codigo, nombre, tipo, activo } = req.body;
    const nombreLimpio = limpiar(nombre);

    if (!nombreLimpio || !tipo) {
        return res.status(400).json({ error: "Faltan campos requeridos (nombre, tipo)" });
    }
    if (!esTipo(tipo)) {
        return res.status(400).json({ error: `tipo debe ser uno de: ${TIPOS_CATEGORIA.join(', ')}` });
    }

    try {
        if (id) {
            const actual = await query('SELECT tipo FROM categoria WHERE id = $1', [id]);
            if (actual.rows.length === 0) {
                return res.status(404).json({ error: "Categoría no encontrada" });
            }

            // Cambiar el tipo cambia la tabla donde viven las subcategorías,
            // así que solo se permite si la categoría no tiene subcategorías.
            if (actual.rows[0].tipo !== tipo) {
                const total = await contarSubcategoriasDeCategoria(id);
                if (total > 0) {
                    return res.status(409).json({
                        error: "No se puede cambiar el tipo de una categoría que tiene subcategorías"
                    });
                }
            }

            const result = await query(`
                UPDATE categoria SET
                    codigo = $1,
                    nombre = $2,
                    tipo = $3,
                    activo = $4,
                    actualizado_en = NOW()
                WHERE id = $5
                RETURNING *
            `, [limpiar(codigo), nombreLimpio, tipo, activo ?? true, id]);

            return res.status(200).json({
                message: 'Categoría actualizada correctamente',
                data: result.rows[0]
            });
        }

        const result = await query(`
            INSERT INTO categoria (codigo, nombre, tipo, activo)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [limpiar(codigo), nombreLimpio, tipo, activo ?? true]);

        res.status(200).json({
            message: 'Categoría creada correctamente',
            data: result.rows[0]
        });
    } catch (error: any) {
        console.error(error);
        if (error?.code === '23505') {
            return res.status(409).json({ error: "Ya existe una categoría con ese código" });
        }
        res.status(500).json({ error: "No se pudo crear/actualizar la categoría" });
    }
};

// =========================================
// SUBCATEGORÍAS
// =========================================

export const ListarSubcategorias = async (req: Request, res: Response) => {
    try {
        const result = await query(`
            SELECT
                s.id,
                s.codigo,
                s.nombre,
                s.descripcion,
                s.activo,
                s.categoria_id,
                json_build_object(
                    'id', c.id,
                    'codigo', c.codigo,
                    'nombre', c.nombre,
                    'tipo', c.tipo
                ) AS categoria,
                s.creado_en,
                s.actualizado_en
            FROM (${SUBCATEGORIAS_UNIFICADAS}) s
            JOIN categoria c ON c.id = s.categoria_id
            ORDER BY c.tipo ASC, c.nombre ASC, s.nombre ASC
        `);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "No se pudieron cargar las subcategorías" });
    }
};

export const ListarSubcategoriasPorCategoria = async (req: Request, res: Response) => {
    const { categoria_id } = req.params;
    try {
        const result = await query(`
            SELECT s.id, s.codigo, s.nombre, s.descripcion, s.activo, s.categoria_id, s.creado_en, s.actualizado_en
            FROM (${SUBCATEGORIAS_UNIFICADAS}) s
            WHERE s.categoria_id = $1
            ORDER BY s.nombre ASC
        `, [categoria_id]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "No se pudieron cargar las subcategorías" });
    }
};

// GET /api/subcategorias/:id?tipo=Gasto
export const ListarSubcategoriaId = async (req: Request, res: Response) => {
    const { id } = req.params;
    const tipo = req.query.tipo;

    if (!esTipo(tipo)) {
        return res.status(400).json({ error: "Falta o es inválido el parámetro tipo (Ingreso | Gasto)" });
    }

    try {
        const result = await query(`
            SELECT
                s.id,
                s.codigo,
                s.nombre,
                s.descripcion,
                s.activo,
                s.categoria_id,
                json_build_object(
                    'id', c.id,
                    'codigo', c.codigo,
                    'nombre', c.nombre,
                    'tipo', c.tipo
                ) AS categoria,
                s.creado_en,
                s.actualizado_en
            FROM ${TABLA_SUBCATEGORIA[tipo]} s
            JOIN categoria c ON c.id = s.categoria_id
            WHERE s.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Subcategoría no encontrada" });
        }
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "No se pudo cargar la subcategoría" });
    }
};

export const ActualizarSubcategoria = async (req: Request, res: Response) => {
    const { id, codigo, nombre, descripcion, activo, categoria_id, tipo_origen } = req.body;
    const nombreLimpio = limpiar(nombre);

    if (!nombreLimpio || !categoria_id) {
        return res.status(400).json({ error: "Faltan campos requeridos (nombre, categoria_id)" });
    }

    try {
        const cat = await query('SELECT tipo FROM categoria WHERE id = $1', [categoria_id]);
        if (cat.rows.length === 0) {
            return res.status(400).json({ error: "La categoría indicada no existe" });
        }
        const tipoDestino: TipoCategoria = cat.rows[0].tipo;
        const tablaDestino = TABLA_SUBCATEGORIA[tipoDestino];
        const codigoLimpio = limpiar(codigo);
        const descripcionLimpia = limpiar(descripcion);

        // Alta
        if (!id) {
            const result = await query(`
                INSERT INTO ${tablaDestino} (codigo, nombre, descripcion, activo, categoria_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
            `, [codigoLimpio, nombreLimpio, descripcionLimpia, activo ?? true, categoria_id]);

            return res.status(200).json({
                message: 'Subcategoría creada correctamente',
                data: result.rows[0]
            });
        }

        // Edición: el tipo de origen indica en qué tabla está hoy la fila
        if (!esTipo(tipo_origen)) {
            return res.status(400).json({ error: "Falta tipo_origen para editar una subcategoría" });
        }
        const tablaOrigen = TABLA_SUBCATEGORIA[tipo_origen];

        const existe = await query(`SELECT 1 FROM ${tablaOrigen} WHERE id = $1`, [id]);
        if (existe.rows.length === 0) {
            return res.status(404).json({ error: "Subcategoría no encontrada" });
        }

        let result;

        if (tipo_origen === tipoDestino) {
            result = await query(`
                UPDATE ${tablaDestino} SET
                    codigo = $1,
                    nombre = $2,
                    descripcion = $3,
                    activo = $4,
                    categoria_id = $5,
                    actualizado_en = NOW()
                WHERE id = $6
                RETURNING *
            `, [codigoLimpio, nombreLimpio, descripcionLimpia, activo ?? true, categoria_id, id]);
        } else {
            // Cambio de tipo: la fila debe pasar de una tabla a otra.
            // Solo se permite si no tiene movimientos.
            const movs = await contarMovimientosDeSubcategoria(tipo_origen, id);
            if (movs > 0) {
                return res.status(409).json({
                    error: "No se puede mover la subcategoría a otro tipo porque ya tiene movimientos"
                });
            }

            // Borrar y reinsertar en una sola sentencia (atómica)
            result = await query(`
                WITH borrada AS (
                    DELETE FROM ${tablaOrigen} WHERE id = $6 RETURNING id
                )
                INSERT INTO ${tablaDestino} (codigo, nombre, descripcion, activo, categoria_id)
                SELECT $1::varchar, $2::varchar, $3::text, $4::boolean, $5::int FROM borrada
                RETURNING *
            `, [codigoLimpio, nombreLimpio, descripcionLimpia, activo ?? true, categoria_id, id]);
        }

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Subcategoría no encontrada" });
        }

        return res.status(200).json({
            message: 'Subcategoría actualizada correctamente',
            data: result.rows[0]
        });
    } catch (error: any) {
        console.error(error);
        if (error?.code === '23505') {
            return res.status(409).json({ error: "Ya existe una subcategoría con ese código o nombre en esta categoría" });
        }
        if (error?.code === '23503') {
            return res.status(400).json({ error: "La categoría indicada no existe" });
        }
        res.status(500).json({ error: "No se pudo crear/actualizar la subcategoría" });
    }
};