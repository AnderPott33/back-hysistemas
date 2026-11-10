import { Router } from 'express';
import {  ActualizarPersona, CrearPersona, ListarPersonas, ObtenerPersonaId } from '../controllers/persona.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.get('/', authenticateToken, ListarPersonas);
router.get('/:id', authenticateToken, ObtenerPersonaId);
router.post('/', authenticateToken, CrearPersona);
router.put('/:id', authenticateToken, ActualizarPersona);

export default router;
