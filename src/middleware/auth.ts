import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db/db';

const SECRET_KEY = process.env.JWT_SECRET || 'clave_super_secreta_owl';

export const authenticateToken = (req: any, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Formato: "Bearer TOKEN"

  if (!token) return res.status(401).json({ message: 'Acceso denegado. Token no provisto.' });

  jwt.verify(token, SECRET_KEY, (err: any, user: any) => {
    if (err) return res.status(403).json({ message: 'Token inválido o expirado.' });
    req.user = user; 
    next();
  });
};

export const requireMaster = async (req: Request, res: Response, next: any) => {
  const userId = (req as any).user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'No autenticado' });
  }

  try {
    const result = await query(
      'SELECT es_usuario_master, activo FROM usuarios WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];

    if (!user || !user.activo || !user.es_usuario_master) {
      return res.status(403).json({ message: 'Solo usuarios maestros pueden hacer esto' });
    }

    next();
  } catch (error) {
    console.error('Error en requireMaster:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};