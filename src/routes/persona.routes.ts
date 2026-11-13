import { Router } from 'express';
import {  ActualizarPersona, CrearPersona, ListarPersonas, ObtenerPersonaId } from '../controllers/persona.controller';
import { authenticateToken } from '../middleware/auth';
import { obtenerCreditoPersona, registrarCreditoPersona } from '../controllers/creditoPersona.controller';

const router = Router();

router.get('/:id/credito', authenticateToken, obtenerCreditoPersona);
router.post('/:id/credito', authenticateToken, registrarCreditoPersona);

router.get('/', authenticateToken, ListarPersonas);
router.get('/:id', authenticateToken, ObtenerPersonaId);
router.post('/', authenticateToken, CrearPersona);
router.put('/:id', authenticateToken, ActualizarPersona);

export default router;
