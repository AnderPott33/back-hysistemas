import { Router } from 'express';
import {
    ObtenerTransacciones,
    ObtenerTransaccionPorId,
    ActualizarTransaccion,
    AnularTransaccion,
   /*  ObtenerArticulos,
    ObtenerCategorias,
    ObtenerMonedas,
    ObtenerTiposCambio,
    ObtenerPersonas,
    ObtenerCuentas, */
    crearTransaccion
} from '../controllers/transaccion.controller.js';

const router = Router();
router.get('/transacciones', ObtenerTransacciones);
router.post('/', crearTransaccion);
router.get('/transacciones/:id', ObtenerTransaccionPorId);
router.put('/transacciones/:id', ActualizarTransaccion);
router.delete('/transacciones/:id', AnularTransaccion);

/* router.get('/articulos', ObtenerArticulos);
router.get('/categorias', ObtenerCategorias);
router.get('/monedas', ObtenerMonedas);
router.get('/tipos-cambio', ObtenerTiposCambio);
router.get('/personas', ObtenerPersonas);
router.get('/cuentas', ObtenerCuentas); */

export default router;