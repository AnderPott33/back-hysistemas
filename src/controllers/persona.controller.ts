import { Request, Response } from 'express';
import { query } from '../db/db.js';

// ============================================================================
// FUNCIÓN HELPER: Validar tipo de persona
// ============================================================================
const esValidoTipoPersona = (tipo: string): tipo is 'Física' | 'Jurídica' => {
    return ['Física', 'Jurídica'].includes(tipo);
};

// ============================================================================
// LISTAR TODAS LAS PERSONAS
// ============================================================================
export const ListarPersonas = async (req: Request, res: Response) => {
    try {
        const consultaSQL = `
            SELECT
                id,
                tipo_persona,
                nombre,
                razon_social,
                cedula,
                ruc,
                email,
                telefono,
                direccion,
                ciudad,
                departamento,
                pais,
                categoria,
                activo,
                creado_en,
                actualizado_en
            FROM persona
            WHERE activo = true
            ORDER BY nombre ASC
        `;

        const result = await query(consultaSQL);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error('Error al listar personas:', error);
        res.status(500).json({
            mensaje: "Error al listar personas",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

// ============================================================================
// OBTENER PERSONA POR ID
// ============================================================================
export const ObtenerPersonaId = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({
            mensaje: "ID de persona requerido"
        });
    }

    try {
        const consultaSQL = `
            SELECT
                id,
                tipo_persona,
                nombre,
                razon_social,
                cedula,
                ruc,
                email,
                telefono,
                direccion,
                ciudad,
                departamento,
                pais,
                categoria,
                activo,
                creado_en,
                actualizado_en
            FROM persona
            WHERE id = $1
        `;

        const result = await query(consultaSQL, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                mensaje: "Persona no encontrada",
                id: id
            });
        }

        res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error("Error al buscar persona por ID:", error);
        res.status(500).json({
            mensaje: "Error al buscar la persona",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

// ============================================================================
// CREAR NUEVA PERSONA
// ============================================================================
export const CrearPersona = async (req: Request, res: Response) => {
    const {
        tipo_persona,
        nombre,
        razon_social,
        cedula,
        ruc,
        email,
        telefono,
        direccion,
        ciudad,
        departamento,
        pais = 'Paraguay',
        categoria,
        activo = true
    } = req.body;

    // Validaciones básicas
    if (!nombre || nombre.trim() === '') {
        return res.status(400).json({
            mensaje: "El nombre es obligatorio"
        });
    }

    if (!tipo_persona || !esValidoTipoPersona(tipo_persona)) {
        return res.status(400).json({
            mensaje: "El tipo_persona debe ser 'Física' o 'Jurídica'"
        });
    }

    // Validación: Persona Jurídica debe tener RUC y razón social
    if (tipo_persona === 'Jurídica') {
        if (!ruc || ruc.trim() === '') {
            return res.status(400).json({
                mensaje: "Para personas jurídicas, el RUC es obligatorio"
            });
        }
        if (!razon_social || razon_social.trim() === '') {
            return res.status(400).json({
                mensaje: "Para personas jurídicas, la razón social es obligatoria"
            });
        }
    }

    // Validación: Persona Física debe tener Cédula
    if (tipo_persona === 'Física' && (!cedula)) {
        return res.status(400).json({
            mensaje: "Para personas físicas, la cédula es obligatoria"
        });
    }

    try {
        const consultaSQL = `
            INSERT INTO persona (
                tipo_persona,
                nombre,
                razon_social,
                cedula,
                ruc,
                email,
                telefono,
                direccion,
                ciudad,
                departamento,
                pais,
                categoria,
                activo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `;

        const result = await query(consultaSQL, [
            tipo_persona,
            nombre.trim(),
            razon_social?.trim() || null,
            cedula || null,
            ruc?.trim() || null,
            email?.trim() || null,
            telefono?.trim() || null,
            direccion?.trim() || null,
            ciudad?.trim() || null,
            departamento?.trim() || null,
            pais?.trim() || 'Paraguay',
            categoria?.trim() || null,
            activo
        ]);

        res.status(201).json({
            mensaje: "Persona creada exitosamente",
            data: result.rows[0]
        });

    } catch (error) {
        console.error("Error al crear persona:", error);

        // Manejo de errores de constraint único
        if (error instanceof Error && error.message.includes('unique constraint')) {
            return res.status(400).json({
                mensaje: "La cédula o RUC ya existe en el sistema"
            });
        }

        res.status(500).json({
            mensaje: "Error al crear la persona",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

// ============================================================================
// ACTUALIZAR PERSONA
// ============================================================================
export const ActualizarPersona = async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
        tipo_persona,
        nombre,
        razon_social,
        cedula,
        ruc,
        email,
        telefono,
        direccion,
        ciudad,
        departamento,
        pais,
        categoria,
        activo,
        observacion,
    } = req.body;

    if (!id) {
        return res.status(400).json({
            mensaje: "ID de persona requerido"
        });
    }

    // Validaciones básicas
    if (nombre !== undefined && (!nombre || nombre.trim() === '')) {
        return res.status(400).json({
            mensaje: "El nombre no puede estar vacío"
        });
    }

    if (tipo_persona !== undefined && !esValidoTipoPersona(tipo_persona)) {
        return res.status(400).json({
            mensaje: "El tipo_persona debe ser 'Física' o 'Jurídica'"
        });
    }

    try {
        // Verificar que la persona existe
        const personaExistente = await query('SELECT * FROM persona WHERE id = $1', [id]);

        if (personaExistente.rows.length === 0) {
            return res.status(404).json({
                mensaje: "Persona no encontrada"
            });
        }

        // Usar valores existentes como default
        const personaActual = personaExistente.rows[0];
        const tipoActualizado = tipo_persona || personaActual.tipo_persona;

        // Validación: Persona Jurídica debe tener RUC y razón social
        if (tipoActualizado === 'Jurídica') {
            const rucValue = ruc !== undefined ? ruc : personaActual.ruc;
            const rsValue = razon_social !== undefined ? razon_social : personaActual.razon_social;

            if (!rucValue || rucValue.trim() === '') {
                return res.status(400).json({
                    mensaje: "Para personas jurídicas, el RUC es obligatorio"
                });
            }
            if (!rsValue || rsValue.trim() === '') {
                return res.status(400).json({
                    mensaje: "Para personas jurídicas, la razón social es obligatoria"
                });
            }
        }

        const consultaSQL = `
            UPDATE persona SET
                tipo_persona = COALESCE($1, tipo_persona),
                nombre = COALESCE($2, nombre),
                razon_social = COALESCE($3, razon_social),
                cedula = COALESCE($4, cedula),
                ruc = COALESCE($5, ruc),
                email = COALESCE($6, email),
                telefono = COALESCE($7, telefono),
                direccion = COALESCE($8, direccion),
                ciudad = COALESCE($9, ciudad),
                departamento = COALESCE($10, departamento),
                pais = COALESCE($11, pais),
                categoria = COALESCE($12, categoria),
                activo = COALESCE($13, activo),
                actualizado_en = NOW()
            WHERE id = $14
            RETURNING *
        `;

        const result = await query(consultaSQL, [
            tipo_persona || null,
            nombre?.trim() || null,
            razon_social?.trim() || null,
            cedula ?? null,
            ruc?.trim() || null,
            email?.trim() || null,
            telefono?.trim() || null,
            direccion?.trim() || null,
            ciudad?.trim() || null,
            departamento?.trim() || null,
            pais?.trim() || null,
            categoria?.trim() || null,
            activo !== undefined ? activo : null,
            id
        ]);

        res.status(200).json({
            mensaje: "Persona actualizada exitosamente",
            data: result.rows[0]
        });

    } catch (error) {
        console.error("Error al actualizar persona:", error);

        // Manejo de errores de constraint único
        if (error instanceof Error && error.message.includes('unique constraint')) {
            return res.status(400).json({
                mensaje: "La cédula o RUC ya existe en el sistema"
            });
        }

        res.status(500).json({
            mensaje: "Error al actualizar la persona",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

// ============================================================================
// ELIMINAR PERSONA (Soft Delete - Marcar como inactivo)
// ============================================================================
export const EliminarPersona = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({
            mensaje: "ID de persona requerido"
        });
    }

    try {
        // Soft delete: marcar como inactivo en lugar de eliminar
        const consultaSQL = `
            UPDATE persona SET
                activo = false,
                actualizado_en = NOW()
            WHERE id = $1
            RETURNING *
        `;

        const result = await query(consultaSQL, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                mensaje: "Persona no encontrada"
            });
        }

        res.status(200).json({
            mensaje: "Persona eliminada exitosamente (marcada como inactiva)",
            data: result.rows[0]
        });

    } catch (error) {
        console.error("Error al eliminar persona:", error);
        res.status(500).json({
            mensaje: "Error al eliminar la persona",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

// ============================================================================
// ELIMINAR PERSONA (Hard Delete - Permanente)
// ============================================================================
export const EliminarPersonaPermanente = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({
            mensaje: "ID de persona requerido"
        });
    }

    try {
        const consultaSQL = `
            DELETE FROM persona
            WHERE id = $1
            RETURNING id
        `;

        const result = await query(consultaSQL, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                mensaje: "Persona no encontrada"
            });
        }

        res.status(200).json({
            mensaje: "Persona eliminada permanentemente",
            id: result.rows[0].id
        });

    } catch (error) {
        console.error("Error al eliminar persona permanentemente:", error);

        // Manejo de errores si hay referencias externas
        if (error instanceof Error && error.message.includes('foreign key')) {
            return res.status(400).json({
                mensaje: "No se puede eliminar esta persona porque tiene registros asociados. Use soft delete en su lugar."
            });
        }

        res.status(500).json({
            mensaje: "Error al eliminar la persona",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

// ============================================================================
// BUSCAR PERSONAS POR CRITERIOS
// ============================================================================
export const BuscarPersonas = async (req: Request, res: Response) => {
    const { nombre, tipo_persona, cedula, ruc, activo } = req.query;

    try {
        let consultaSQL = 'SELECT * FROM persona WHERE 1=1';
        const params: any[] = [];
        let paramCount = 1;

        if (nombre && nombre !== '') {
            consultaSQL += ` AND LOWER(nombre) LIKE LOWER($${paramCount})`;
            params.push(`%${nombre}%`);
            paramCount++;
        }

        if (tipo_persona && tipo_persona !== '') {
            consultaSQL += ` AND tipo_persona = $${paramCount}`;
            params.push(tipo_persona);
            paramCount++;
        }

        if (cedula && cedula !== '') {
            consultaSQL += ` AND cedula = $${paramCount}`;
            params.push(cedula);
            paramCount++;
        }

        if (ruc && ruc !== '') {
            consultaSQL += ` AND ruc = $${paramCount}`;
            params.push(ruc);
            paramCount++;
        }

        if (activo !== undefined && activo !== '') {
            consultaSQL += ` AND activo = $${paramCount}`;
            params.push(activo === 'true');
            paramCount++;
        }

        consultaSQL += ' ORDER BY nombre ASC';

        const result = await query(consultaSQL, params);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error("Error al buscar personas:", error);
        res.status(500).json({
            mensaje: "Error al buscar personas",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

// ============================================================================
// OBTENER PERSONAS POR TIPO
// ============================================================================
/* export const PersonasPorTipo = async (req: Request, res: Response) => {
    const { tipo_persona } = req.params;

    if (!tipo_persona || !esValidoTipoPersona(tipo_persona)) {
        return res.status(400).json({
            mensaje: "Tipo de persona inválido. Debe ser 'Física' o 'Jurídica'"
        });
    }

    try {
        const consultaSQL = `
            SELECT *
            FROM persona
            WHERE tipo_persona = $1
            AND activo = true
            ORDER BY nombre ASC
        `;

        const result = await query(consultaSQL, [tipo_persona]);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error("Error al obtener personas por tipo:", error);
        res.status(500).json({
            mensaje: "Error al obtener personas por tipo",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
}; */

// ============================================================================
// OBTENER PERSONAS POR CATEGORÍA
// ============================================================================
export const PersonasPorCategoria = async (req: Request, res: Response) => {
    const { categoria } = req.params;

    if (!categoria) {
        return res.status(400).json({
            mensaje: "Categoría requerida"
        });
    }

    try {
        const consultaSQL = `
            SELECT *
            FROM persona
            WHERE categoria = $1
            AND activo = true
            ORDER BY nombre ASC
        `;

        const result = await query(consultaSQL, [categoria]);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error("Error al obtener personas por categoría:", error);
        res.status(500).json({
            mensaje: "Error al obtener personas por categoría",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

// ============================================================================
// OBTENER PERSONAS POR CIUDAD
// ============================================================================
export const PersonasPorCiudad = async (req: Request, res: Response) => {
    const { ciudad } = req.params;

    if (!ciudad) {
        return res.status(400).json({
            mensaje: "Ciudad requerida"
        });
    }

    try {
        const consultaSQL = `
            SELECT *
            FROM persona
            WHERE LOWER(ciudad) = LOWER($1)
            AND activo = true
            ORDER BY nombre ASC
        `;

        const result = await query(consultaSQL, [ciudad]);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error("Error al obtener personas por ciudad:", error);
        res.status(500).json({
            mensaje: "Error al obtener personas por ciudad",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

// ============================================================================
// ESTADÍSTICAS DE PERSONAS
// ============================================================================
export const EstadisticasPersonas = async (req: Request, res: Response) => {
    try {
        const consultaSQL = `
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN activo = true THEN 1 ELSE 0 END) as activos,
                SUM(CASE WHEN activo = false THEN 1 ELSE 0 END) as inactivos,
                SUM(CASE WHEN tipo_persona = 'Física' THEN 1 ELSE 0 END) as tipo_fisica,
                SUM(CASE WHEN tipo_persona = 'Jurídica' THEN 1 ELSE 0 END) as tipo_juridica
            FROM persona
        `;

        const result = await query(consultaSQL);
        res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error("Error al obtener estadísticas:", error);
        res.status(500).json({
            mensaje: "Error al obtener estadísticas",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};

// ============================================================================
// VERIFICAR DISPONIBILIDAD DE CÉDULA/RUC
// ============================================================================
export const VerificarDisponibilidad = async (req: Request, res: Response) => {
    const { tipo, valor } = req.query;

    if (!tipo || !valor) {
        return res.status(400).json({
            mensaje: "Se requiere 'tipo' (cedula o ruc) y 'valor'"
        });
    }

    if (!['cedula', 'ruc'].includes(tipo as string)) {
        return res.status(400).json({
            mensaje: "El tipo debe ser 'cedula' o 'ruc'"
        });
    }

    try {
        const consultaSQL = `
            SELECT id
            FROM persona
            WHERE ${tipo} = $1
        `;

        const result = await query(consultaSQL, [valor]);

        res.status(200).json({
            disponible: result.rows.length === 0,
            tipo: tipo,
            valor: valor
        });

    } catch (error) {
        console.error("Error al verificar disponibilidad:", error);
        res.status(500).json({
            mensaje: "Error al verificar disponibilidad",
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
};