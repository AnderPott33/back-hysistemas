import { Router } from 'express';
import {
    obtenerGrupos,
    obtenerGrupoPorId,
    crearGrupo,
    actualizarGrupo,
    eliminarGrupo,
} from '../controllers/grupoPrivilegios.controller';

import { authenticateToken } from '../middleware/auth';


const router = Router();

router.get("/grupos", authenticateToken, obtenerGrupos);
router.get("/grupos/:id", authenticateToken, obtenerGrupoPorId);
router.post("/create", authenticateToken, crearGrupo);
router.put("/:id", authenticateToken, actualizarGrupo);
router.delete("/:id", authenticateToken, eliminarGrupo);

export default router;