import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';

import { buscarEmpresa, buscarEmpresaId, crearActualizarEmpresa } from '../controllers/empresa.controller';


const router = Router();

router.get('/', authenticateToken, buscarEmpresa);
router.post('/buscar/:id', authenticateToken, buscarEmpresaId);
router.post('/', authenticateToken, crearActualizarEmpresa);

export default router;