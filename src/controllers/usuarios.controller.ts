import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../db/db.js';

const SECRET_KEY = process.env.JWT_SECRET || 'clave_super_secreta_owl';
const PASSWORD_MIN_LENGTH = 8;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const THEME_MODES = ['light', 'dark'] as const;
type ThemeMode = (typeof THEME_MODES)[number];

const isValidThemeMode = (value: unknown): value is ThemeMode =>
  typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const result = await query(`
      SELECT
        u.id,
        u.email,
        u.contrasena,
        u.activo,
        u.nombre,
        r.id AS rol_id,
        r.nombre AS rol_nombre,
        u.es_usuario_master,
        u.theme_color AS "themeColor",
        u.theme_mode AS "themeMode"
      FROM usuarios u
      LEFT JOIN grupo_privilegios r ON u.grupo_privilegios = r.id
      WHERE u.email = $1
    `, [email]);

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    if (!user.activo) {
      return res.status(403).json({ message: 'Usuario inactivo' });
    }

    const validPassword = await bcrypt.compare(password, user.contrasena);
    if (!validPassword) {
      return res.status(401).json({ message: 'Contraseña incorrecta' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol_id: user.rol_id,
        rol_nombre: user.rol_nombre,
        es_usuario_master: user.es_usuario_master,
      },
      SECRET_KEY,
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Bienvenido',
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        es_usuario_master: user.es_usuario_master,
        themeColor: user.themeColor ?? null,
        themeMode: user.themeMode ?? 'light',
        rol: {
          id: user.rol_id,
          nombre: user.rol_nombre,
        },
        activo: user.activo,
      },
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: (error as Error).message });
  }
};

export const verifyToken = (req: Request, res: Response, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Token no proporcionado' });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    (req as any).user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido o expirado' });
  }
};

export const updateThemeForAllUsers = async (req: Request, res: Response) => {
  const { themeColor, themeMode } = req.body;

  if (typeof themeColor !== 'string' || !HEX_COLOR_REGEX.test(themeColor)) {
    return res.status(400).json({ message: 'themeColor inválido. Usa formato #RRGGBB' });
  }

  if (themeMode !== undefined && !isValidThemeMode(themeMode)) {
    return res.status(400).json({ message: "themeMode inválido. Usa 'light' o 'dark'" });
  }

  try {
    const result = await query(
      `UPDATE usuarios
       SET theme_color = $1,
           theme_mode  = COALESCE($2, theme_mode)
       RETURNING id`,
      [themeColor.toLowerCase(), themeMode ?? null]
    );

    res.json({
      message: 'Tema aplicado a todos los usuarios',
      themeColor: themeColor.toLowerCase(),
      themeMode: themeMode ?? null,
      updated: result.rows.length,
    });
  } catch (error) {
    console.error('Error al aplicar tema global:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

export const updateThemePreference = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const { themeColor, themeMode } = req.body;

  if (!userId) {
    return res.status(401).json({ message: 'No autenticado' });
  }

  if (themeColor !== undefined && (typeof themeColor !== 'string' || !HEX_COLOR_REGEX.test(themeColor))) {
    return res.status(400).json({ message: 'themeColor inválido. Usa formato #RRGGBB' });
  }

  if (themeMode !== undefined && !isValidThemeMode(themeMode)) {
    return res.status(400).json({ message: "themeMode inválido. Usa 'light' o 'dark'" });
  }

  if (themeColor === undefined && themeMode === undefined) {
    return res.status(400).json({ message: 'Nada que actualizar' });
  }

  try {
    const result = await query(
      `UPDATE usuarios
       SET theme_color = COALESCE($1, theme_color),
           theme_mode  = COALESCE($2, theme_mode)
       WHERE id = $3
       RETURNING theme_color AS "themeColor", theme_mode AS "themeMode"`,
      [themeColor ? themeColor.toLowerCase() : null, themeMode ?? null, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({
      message: 'Preferencia de tema guardada',
      themeColor: result.rows[0].themeColor,
      themeMode: result.rows[0].themeMode,
    });
  } catch (error) {
    console.error('Error al guardar tema:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  const userIdd = (req as any).user?.id;
  const { currentPassword, newPassword, userId } = req.body;

  const idUsuario = userId ? userId : userIdd;

  // Validación de autenticación
  if (!idUsuario) {
    return res.status(401).json({
      success: false,
      message: 'No autenticado'
    });
  }

  // Validación de entrada
  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Las contraseñas actual y nueva son requeridas'
    });
  }

  // Validar que la nueva contraseña cumpla requisitos
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `La nueva contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`
    });
  }

  // Evitar que sea igual a la actual
  if (currentPassword === newPassword) {
    return res.status(400).json({
      success: false,
      message: 'La nueva contraseña no puede ser igual a la actual'
    });
  }

  try {
    // Buscar usuario
    const result = await query(
      'SELECT contrasena FROM usuarios WHERE id = $1',
      [idUsuario]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Validar contraseña actual
    const validPassword = await bcrypt.compare(currentPassword, user.contrasena);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: 'Contraseña actual incorrecta'
      });
    }

    // Hash de nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Actualizar en BD
    await query(
      'UPDATE usuarios SET contrasena = $1 WHERE id = $2',
      [hashedPassword, idUsuario]
    );

    res.status(200).json({
      success: true,
      message: 'Contraseña actualizada exitosamente'
    });

  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor. Por favor, intenta nuevamente'
    });
  }
};

export const changePasswordAdmin = async (req: Request, res: Response) => {
  const { newPassword, userId } = req.body;

  // Validación de autenticación
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Usuario ID es requerido'
    });
  }

  // Validación de entrada
  if (!newPassword) {
    return res.status(400).json({
      success: false,
      message: 'La contraseña nueva es requerida'
    });
  }

  // Validar que la nueva contraseña cumpla requisitos
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`
    });
  }

  try {
    // Buscar usuario
    const result = await query(
      'SELECT id FROM usuarios WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Hash de nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Actualizar en BD
    await query(
      'UPDATE usuarios SET contrasena = $1 WHERE id = $2',
      [hashedPassword, userId]
    );

    res.status(200).json({
      success: true,
      message: 'Contraseña actualizada exitosamente'
    });

  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor. Por favor, intenta nuevamente'
    });
  }
};

export const createUser = async (req: Request, res: Response) => {
  const { email, contrasena, nombre, grupo_privilegios, activo } = req.body;

  const password = contrasena;

  try {
    // Validar campos requeridos
    if (!email || !password || !nombre) {
      return res.status(400).json({
        message: 'Email, nombre y contraseña son requeridos'
      });
    }

    // Validar que el email no esté registrado
    const emailExists = await query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (emailExists.rows.length > 0) {
      return res.status(400).json({ message: 'El email ya está registrado' });
    }

    // Validar que el nombre no esté registrado
    const nameExists = await query('SELECT id FROM usuarios WHERE nombre = $1', [nombre]);
    if (nameExists.rows.length > 0) {
      return res.status(400).json({ message: 'El nombre de usuario ya está registrado' });
    }

    // Validar longitud de contraseña
    if (password.length < PASSWORD_MIN_LENGTH) {
      return res.status(400).json({
        message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO usuarios (email, contrasena, nombre, grupo_privilegios, activo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, nombre, grupo_privilegios, activo, creado_en`,
      [email, hashedPassword, nombre, grupo_privilegios, activo]
    );

    const newUser = result.rows[0];

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: {
        id: newUser.id,
        email: newUser.email,
        nombre: newUser.nombre,
        grupo_privilegios: newUser.grupo_privilegios,
        activo: newUser.activo,
        creado_en: newUser.creado_en
      }
    });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({
      message: 'Error al crear usuario',
      error: (error as Error).message
    });
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT
        u.id,
        u.email,
        u.nombre,
        u.caja_logueada,
        u.grupo_privilegios,
        u.activo,
        u.creado_en,
        r.nombre as rol_nombre,
        u.es_usuario_master
      FROM usuarios u
      LEFT JOIN grupo_privilegios r ON u.grupo_privilegios = r.id
      ORDER BY u.id
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getUserById = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await query(`
      SELECT
        u.id,
        u.email,
        u.grupo_privilegios,
        u.caja_logueada,
        u.activo,
        u.creado_en,
        u.nombre,
        r.nombre as rol_nombre,
        u.es_usuario_master
      FROM usuarios u
      LEFT JOIN grupo_privilegios r ON u.grupo_privilegios = r.id
      WHERE u.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({ error: (error as Error).message });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { email, nombre, grupo_privilegios, activo } = req.body;

  try {
    // Verificar que el usuario existe
    const userExists = await query('SELECT id FROM usuarios WHERE id = $1', [userId]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Validar email si se proporciona
    if (email) {
      const emailExists = await query(
        'SELECT id FROM usuarios WHERE email = $1 AND id != $2',
        [email, userId]
      );
      if (emailExists.rows.length > 0) {
        return res.status(400).json({ message: 'El email ya está registrado' });
      }
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    // Agregar email si se proporciona
    if (email) {
      fields.push(`email = $${paramCount}`);
      values.push(email);
      paramCount++;
    }

    if (nombre) {
      fields.push(`nombre = $${paramCount}`);
      values.push(nombre);
      paramCount++;
    }

    // Agregar grupo_privilegios si se proporciona
    if (grupo_privilegios !== undefined) {
      fields.push(`grupo_privilegios = $${paramCount}`);
      values.push(grupo_privilegios || null);
      paramCount++;
    }

    // Agregar activo si se proporciona
    if (activo !== undefined) {
      fields.push(`activo = $${paramCount}`);
      values.push(activo);
      paramCount++;
    }

    // Validar que haya campos para actualizar
    if (fields.length === 1) {
      return res.status(400).json({ message: 'No hay campos para actualizar' });
    }

    // Agregar userId como último parámetro
    values.push(userId);

    const result = await query(
      `UPDATE usuarios
       SET ${fields.join(', ')}
       WHERE id = $${paramCount}
       RETURNING
        id,
        email,
        nombre,
        grupo_privilegios,
        activo,
        creado_en`,
      values
    );

    const updatedUser = result.rows[0];

    res.json({
      message: 'Usuario actualizado exitosamente',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        nombre: updatedUser.nombre,
        grupo_privilegios: updatedUser.grupo_privilegios,
        activo: updatedUser.activo,
        creado_en: updatedUser.creado_en
      }
    });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getMe = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'No autenticado' });
  }

  try {
    const result = await query(
      `SELECT
        u.id,
        u.email,
        u.nombre,
        u.activo,
        u.es_usuario_master,
        r.id AS rol_id,
        r.nombre AS rol_nombre,
        u.theme_color AS "themeColor",
        u.theme_mode AS "themeMode"
      FROM usuarios u
      LEFT JOIN grupo_privilegios r ON u.grupo_privilegios = r.id
      WHERE u.id = $1`,
      [userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    if (!user.activo) {
      return res.status(403).json({ message: 'Usuario inactivo' });
    }

    res.json({
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        es_usuario_master: user.es_usuario_master,
        themeColor: user.themeColor ?? null,
        themeMode: user.themeMode ?? 'light',
        rol: { id: user.rol_id, nombre: user.rol_nombre },
        activo: user.activo,
      },
    });
  } catch (error) {
    console.error('Error en getMe:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

export const updateUserPerfil = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const { email, nombre, theme_color } = req.body;

  try {
    // Verificar que el usuario existe
    const userExists = await query('SELECT id FROM usuarios WHERE id = $1', [userId]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Validar email si se proporciona
    if (email) {
      const emailExists = await query(
        'SELECT id FROM usuarios WHERE email = $1 AND id != $2',
        [email, userId]
      );
      if (emailExists.rows.length > 0) {
        return res.status(400).json({ message: 'El email ya está registrado' });
      }
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    // Agregar email si se proporciona
    if (email) {
      fields.push(`email = $${paramCount}`);
      values.push(email);
      paramCount++;
    }

    if (nombre) {
      fields.push(`nombre = $${paramCount}`);
      values.push(nombre);
      paramCount++;
    }

    if (theme_color) {
      fields.push(`theme_color = $${paramCount}`);
      values.push(theme_color);
      paramCount++;
    }

    // Validar que haya campos para actualizar
    if (fields.length === 1) {
      return res.status(400).json({ message: 'No hay campos para actualizar' });
    }

    // Agregar userId como último parámetro
    values.push(userId);

    const result = await query(
      `UPDATE usuarios
       SET ${fields.join(', ')}
       WHERE id = $${paramCount}
       RETURNING
        id,
        email,
        nombre,
        theme_color,
        creado_en`,
      values
    );

    const updatedUser = result.rows[0];

    res.json({
      message: 'Perfil actualizado exitosamente',
    });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ error: (error as Error).message });
  }
};