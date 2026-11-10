import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { extractoCajaBanco, saldoCuenta } from '../controllers/extractoCajaBanco.controller';

const router = Router();

router.post('/', authenticateToken, extractoCajaBanco);
router.get('/cuenta/:id/saldo',authenticateToken, saldoCuenta);

export default router;