import express, { Application } from 'express';
import cors from 'cors';
import axios from 'axios';

import usuariosRoutes from './routes/usuarios.route.js';
import cajasRoutes from './routes/cajas.routes.js';
import grupoPrivilegiosRoutes from './routes/grupoPrivilegios.routes.js';
import monedaRoutes from './routes/moneda.routes.js';
import categoriaGastoIngresoRoutes from './routes/categoriaGastoIngreso.routes.js';
import subcategoriaRoutes from './routes/subCategoria.routes.js';
import cuentasRoutes from './routes/cuentas.routes.js';
import transaccionesRoutes from './routes/transaccion.routes.js';
import personaRoutes from './routes/persona.routes.js';
import articulosRoutes from './routes/articulos.routes.js';
import operacionRoutes from './routes/operacion.routes.js';
import almacenRoutes from './routes/almacen.routes.js';
import timbradoRoutes from './routes/timbrado.routes.js';
import empresaRoutes from './routes/empresa.routes.js';
import financieroRoutes from './routes/financiero.routes.js';
import extractoCajaBancoRoutes from './routes/extractoCajaBanco.routes.js';
import asientosRoutes from './routes/asiento.routes.js';

const app: Application = express();

const origenesPermitidos = [
  'http://localhost:4200',
  'http://localhost:5173',
  'https://front-hysistemas.onrender.com',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

// 🔥 CORS CONFIG
app.use(cors({
  origin: origenesPermitidos,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  credentials: true
}));

// importante para preflight
app.options(/.*/, cors());

app.use(express.json());

app.use('/api/usuarios', usuariosRoutes);
app.use('/api/cajas', cajasRoutes);
app.use('/api/grupo-privilegios', grupoPrivilegiosRoutes);
app.use('/api/moneda', monedaRoutes);
app.use('/api/categorias', categoriaGastoIngresoRoutes);
app.use('/api/subcategorias', subcategoriaRoutes);
app.use('/api/cuentas', cuentasRoutes);
app.use('/api/transacciones', transaccionesRoutes);
app.use('/api/financiero', financieroRoutes);
app.use('/api/personas', personaRoutes);
app.use('/api/articulos', articulosRoutes);
app.use('/api/operacion', operacionRoutes);
app.use('/api/almacen', almacenRoutes);
app.use('/api/timbrado', timbradoRoutes);
app.use('/api/empresa', empresaRoutes);
app.use('/api/extractoCajaBanco', extractoCajaBancoRoutes);
app.use('/api/asientos', asientosRoutes);



// Consulta RUC en el SET (proxy para evitar CORS en el frontend)
app.get('/api/ruc/:ruc', async (req, res) => {
  const ruc = String(req.params.ruc).replace(/\D/g, '');
  if (!ruc) return res.status(400).json({ message: 'RUC inválido' });
  try {
    const { data } = await axios.get(`https://ruc.sun.com.py/api/ruc/${ruc}`, { timeout: 10000 });
    res.json(data);
  } catch (err: any) {
    console.error('Error consultando RUC:', err.message, err.response?.status, err.response?.data);
    res.status(err.response?.status || 502).json({ message: 'No se pudo consultar el RUC' });
  }
});
export default app;