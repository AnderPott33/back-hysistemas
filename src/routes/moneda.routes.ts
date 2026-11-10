import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
    ListarMonedas, ListarMonedaId, ActualizarMoneda,
    ListarTiposCambio, ListarTipoCambioVigente, ListarTipoCambioId, ActualizarTipoCambio,
    ListarMonedasActivas,
    HayTipoCambioHoy
} from '../controllers/moneda.controller';

const router = Router();

// ─── Rutas específicas PRIMERO ───────────────────────────────────────────────

// Listar todas las monedas
router.get('/', authenticateToken, ListarMonedas);
router.get('/activas', authenticateToken, ListarMonedasActivas);

router.get('/cambioHoy', authenticateToken, HayTipoCambioHoy);


// POST para crear/actualizar (moneda o tipo-cambio)
router.post('/', authenticateToken, ActualizarMoneda);
router.post('/tipo-cambio', authenticateToken, ActualizarTipoCambio);

// Rutas específicas de tipo-cambio
router.post('/tipo-cambio/vigente', authenticateToken, ListarTipoCambioVigente);
router.get('/tipo-cambio', authenticateToken, ListarTiposCambio);

// Rutas por ID
router.get('/tipo-cambio/:id', authenticateToken, ListarTipoCambioId);
router.get('/:id', authenticateToken, ListarMonedaId);  // ← MÁS GENÉRICA, AL FINAL

export default router;