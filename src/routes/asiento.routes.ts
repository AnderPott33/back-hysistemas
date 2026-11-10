import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { cancelarAsiento, crearAsientos, obtenerAsiento } from '../controllers/asiento.controller';

const router = Router();

router.post('/asientos', authenticateToken, crearAsientos);
router.get('/asientos/:id', authenticateToken, obtenerAsiento);
router.patch('/asientos/:id/cancelar', authenticateToken, cancelarAsiento);

export default router;