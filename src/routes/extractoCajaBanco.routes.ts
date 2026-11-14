import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { extractoCajaBanco, saldoCuenta } from '../controllers/extractoCajaBanco.controller';
import { dreMensual, saldosSubcategorias } from '../controllers/extractoGastoIngreso.controller';

const router = Router();

router.post('/', authenticateToken, extractoCajaBanco);
router.get('/cuenta/:id/saldo',authenticateToken, saldoCuenta);
router.post('/subcategorias/saldo', authenticateToken, saldosSubcategorias);
router.post('/subcategorias/dre', authenticateToken, dreMensual);

export default router;