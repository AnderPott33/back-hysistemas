import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { cancelarFinanciero, guardarFinanciero, listarFinancieros, obtenerFinanciero } from '../controllers/financiero.controller';


const router = Router();

router.post('/guardar', authenticateToken, guardarFinanciero);
router.get('/financieros', authenticateToken, listarFinancieros); 
router.post('/financiero/:id', authenticateToken, obtenerFinanciero);
router.patch('/financieros/:id/cancelar', authenticateToken, cancelarFinanciero);


export default router;