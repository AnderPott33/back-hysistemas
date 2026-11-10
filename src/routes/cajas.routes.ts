import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { buscarCajaId, buscarCajas, cerrarCaja, reabrirCaja, cajaLogueada, loguearCaja, crearCaja, actualizarCaja } from '../controllers/cajas.controller';

const router = Router();

router.get('/', authenticateToken, buscarCajas);
/* router.get('/saldos/:cajaId', authenticateToken, saldosCajas); */
router.get('/activa', authenticateToken, cajaLogueada);
router.post('/loguear', authenticateToken, loguearCaja);
router.post('/buscar/:id', authenticateToken, buscarCajaId);
router.post('/', authenticateToken, crearCaja);
router.put('/', authenticateToken, actualizarCaja);
router.put('/cerrar/:id', authenticateToken, cerrarCaja);
router.put('/reabrir/:id', authenticateToken, reabrirCaja);


export default router;