import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { agregarActualizarAlmacen, cargarAlmacenes, cargarAlmacenId } from '../controllers/almacen.controller';


const router = Router();

router.get('/:id', authenticateToken, cargarAlmacenId);
router.get('/', authenticateToken, cargarAlmacenes);
router.post('/', authenticateToken, agregarActualizarAlmacen);


export default router;
