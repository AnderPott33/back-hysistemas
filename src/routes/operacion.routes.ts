import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { agregarActualizarOperacion, cargarOperaciones, cargarOperacionId } from '../controllers/operacion.controller';


const router = Router();

router.get('/:id', authenticateToken, cargarOperacionId);
router.get('/', authenticateToken, cargarOperaciones);
router.post('/', authenticateToken, agregarActualizarOperacion);


export default router;
