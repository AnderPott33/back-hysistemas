import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
    ListarSubcategorias,
    ListarSubcategoriaId,
    ListarSubcategoriasPorCategoria,
    ActualizarSubcategoria,
} from '../controllers/categoriaGastoIngreso.controller';

const router = Router();

router.get('/', authenticateToken, ListarSubcategorias);
router.get('/categoria/:categoria_id', authenticateToken, ListarSubcategoriasPorCategoria);
router.get('/:id', authenticateToken, ListarSubcategoriaId);
router.post('/', authenticateToken, ActualizarSubcategoria);

export default router;