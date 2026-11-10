import { Router } from 'express';
import {
  login,
  changePassword,
  verifyToken,
  createUser,
  updateUser,
  getUsers,
  getUserById,
  changePasswordAdmin,
  updateThemePreference,
  updateThemeForAllUsers,
  updateUserPerfil,
  getMe
} from '../controllers/usuarios.controller.js';
import { requireMaster } from '../middleware/auth.js';

const router = Router();

router.post('/login', login);
router.get('/me', verifyToken, getMe);
router.get('/usuarios', verifyToken, getUsers);
router.get('/usuarios/:id', verifyToken, getUserById);
router.post('/change-password', verifyToken, changePassword);
router.post('/change-passwordAdmin', verifyToken, changePasswordAdmin);
router.post('/create-user', verifyToken, createUser);
router.patch('/me/preferencias', verifyToken, updateThemePreference);
router.patch('/usuarios/preferencias/todos', verifyToken, requireMaster, updateThemeForAllUsers);
router.put('/:userId', verifyToken, updateUser);
router.post('/perdil', verifyToken, updateUserPerfil);

export default router;