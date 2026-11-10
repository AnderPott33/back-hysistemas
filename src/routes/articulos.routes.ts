import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { cargarArticulos, obtenerArticuloRapido } from '../controllers/articulos.controller';

const router = Router();

router.get('/', authenticateToken, cargarArticulos);
router.post('/rap', authenticateToken, obtenerArticuloRapido);


export default router;
