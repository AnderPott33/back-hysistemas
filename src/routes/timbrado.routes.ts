import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { agregarActualizarTimbrado, cargarTimbradoId, cargarTimbrados, generarProximoNumero } from '../controllers/timbrado.controller';


const router = Router();

router.get('/:id', authenticateToken, cargarTimbradoId);
router.get('/', authenticateToken, cargarTimbrados);
router.post('/', authenticateToken, agregarActualizarTimbrado);
router.post('/generarSecuencia', authenticateToken, generarProximoNumero)


export default router;
