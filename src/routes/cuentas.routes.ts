import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
    ListarCuentas,
    ListarCuentaId,
    ListarCuentasPorTipo,
    ActualizarCuenta

} from '../controllers/cuentas.controller';

const router = Router();

router.get('/', authenticateToken, ListarCuentas);
/* router.get('/raiz', authenticateToken, ListarCuentasRaiz);
router.get('/analiticas', authenticateToken, ListarCuentasAnaliticas); */
router.get('/tipo/:tipo', authenticateToken, ListarCuentasPorTipo);
router.get('/:id', authenticateToken, ListarCuentaId);
router.post('/', authenticateToken, ActualizarCuenta);

export default router;
