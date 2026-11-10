import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
    ListarCategorias,
    ListarCategoriaId,
    ActualizarCategoria
} from '../controllers/categoriaGastoIngreso.controller';

const router = Router();

router.get('/', authenticateToken, ListarCategorias);
router.get('/:id', authenticateToken, ListarCategoriaId);
router.post('/', authenticateToken, ActualizarCategoria);

export default router;