import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Conexión directa a PostgreSQL de Supabase usando pg Pool
 * Mantiene la misma interfaz que antes - solo cambia la cadena de conexión
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/**
 * Función query - wrapper para ejecutar queries SQL directamente
 * Mantiene compatibilidad total con el código anterior
 * 
 * @param text - Consulta SQL con parámetros ($1, $2, etc.)
 * @param params - Array de parámetros
 * @returns Promesa con resultado de la query
 * 
 * @example
 * const result = await query('SELECT * FROM baja WHERE id = $1', [123]);
 * console.log(result.rows);
 */
export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

// Exportar pool para operaciones que requieren un cliente específico (transacciones)
export { pool };

// Escuchar eventos del pool
pool.on('error', (err) => {
  console.error('Error no esperado en idle client', err);
});

pool.on('connect', () => {
  console.log('✓ Conectado a Supabase PostgreSQL');
});

export default pool;