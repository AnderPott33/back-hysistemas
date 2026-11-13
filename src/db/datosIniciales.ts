import bcrypt from 'bcrypt';
import { query } from './db.js';
import { PRIVILEGIOS_ADMINISTRADOR } from './gruposIniciales.js';

// ============================================
// TABLAS (en orden de dependencia: primero las referenciadas)
// ============================================

const TABLAS: { nombre: string; sql: string }[] = [
  {
    nombre: 'moneda',
    sql: `
CREATE TABLE IF NOT EXISTS public.moneda (
	id serial4 NOT NULL,
	codigo varchar(10) NOT NULL,
	nombre varchar(100) NOT NULL,
	simbolo varchar(5) NOT NULL,
	decimales int4 DEFAULT 2 NULL,
	activo bool DEFAULT true NULL,
	creado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT moneda_codigo_key UNIQUE (codigo),
	CONSTRAINT moneda_nombre_key UNIQUE (nombre),
	CONSTRAINT moneda_pkey PRIMARY KEY (id)
);`,
  },
  {
    nombre: 'grupo_privilegios',
    sql: `
CREATE TABLE IF NOT EXISTS public.grupo_privilegios (
	id serial4 NOT NULL,
	nombre varchar(255) NOT NULL,
	privilegios json NULL,
	creado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT grupo_privilegios_nombre_key UNIQUE (nombre),
	CONSTRAINT grupo_privilegios_pkey PRIMARY KEY (id)
);`,
  },
  {
    nombre: 'usuarios',
    sql: `
CREATE TABLE IF NOT EXISTS public.usuarios (
	id serial4 NOT NULL,
	nombre varchar(255) NOT NULL,
	email varchar(255) NOT NULL,
	contrasena varchar(255) NOT NULL,
	grupo_privilegios int8 NOT NULL,
	caja_logueada int8 NULL,
	activo bool DEFAULT true NULL,
	creado_en timestamptz DEFAULT now() NULL,
	es_usuario_master bool NULL,
	theme_color text NULL,
	img bytea NULL,
	theme_mode varchar(5) DEFAULT 'light'::character varying NOT NULL,
	CONSTRAINT usuarios_email_key UNIQUE (email),
	CONSTRAINT usuarios_nombre_key UNIQUE (nombre),
	CONSTRAINT usuarios_pkey PRIMARY KEY (id),
	CONSTRAINT usuarios_theme_mode_check CHECK (((theme_mode)::text = ANY (ARRAY[('light'::character varying)::text, ('dark'::character varying)::text])))
);`,
  },
  {
    nombre: 'cajas',
    sql: `
CREATE TABLE IF NOT EXISTS public.cajas (
	id serial4 NOT NULL,
	apertura timestamptz NULL,
	cierre timestamptz NULL,
	descripcion varchar(255) NULL,
	estado varchar(50) NULL,
	usuario_id int8 NULL,
	creado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT cajas_pkey PRIMARY KEY (id)
);`,
  },
  {
    nombre: 'timbrado',
    sql: `
CREATE TABLE IF NOT EXISTS public.timbrado (
	id serial4 NOT NULL,
	timbrado numeric NULL,
	tipo_transaccion varchar(100) NULL,
	tipo_nota varchar(100) NULL,
	autorizacion varchar(255) NULL,
	fecha_inicio timestamptz NULL,
	fecha_fin timestamptz NULL,
	punto_expedicion numeric NULL,
	sucursal numeric NULL,
	proximo_numero numeric NULL,
	numero_maximo numeric NULL
);`,
  },
  {
    nombre: 'categoria',
    sql: `
CREATE TABLE IF NOT EXISTS public.categoria (
	id serial4 NOT NULL,
	codigo varchar(50) NULL,
	nombre varchar(255) NOT NULL,
	tipo varchar(20) NOT NULL,
	activo bool DEFAULT true NOT NULL,
	creado_en timestamptz DEFAULT now() NULL,
	actualizado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT categoria_codigo_key UNIQUE (codigo),
	CONSTRAINT categoria_pkey PRIMARY KEY (id),
	CONSTRAINT categoria_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Ingreso'::character varying, 'Gasto'::character varying])::text[])))
);`,
  },
  {
    nombre: 'subcategoria_gasto',
    sql: `
CREATE TABLE IF NOT EXISTS public.subcategoria_gasto (
	id serial4 NOT NULL,
	categoria_id int4 NOT NULL,
	codigo varchar(50) NULL,
	nombre varchar(255) NOT NULL,
	descripcion text NULL,
	activo bool DEFAULT true NOT NULL,
	creado_en timestamptz DEFAULT now() NULL,
	actualizado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT subcategoria_gasto_codigo_key UNIQUE (codigo),
	CONSTRAINT subcategoria_gasto_nombre_unico UNIQUE (categoria_id, nombre),
	CONSTRAINT subcategoria_gasto_pkey PRIMARY KEY (id),
	CONSTRAINT subcategoria_gasto_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.categoria(id) ON DELETE RESTRICT
);`,
  },
  {
    nombre: 'subcategoria_ingreso',
    sql: `
CREATE TABLE IF NOT EXISTS public.subcategoria_ingreso (
	id serial4 NOT NULL,
	categoria_id int4 NOT NULL,
	codigo varchar(50) NULL,
	nombre varchar(255) NOT NULL,
	descripcion text NULL,
	activo bool DEFAULT true NOT NULL,
	creado_en timestamptz DEFAULT now() NULL,
	actualizado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT subcategoria_codigo_key UNIQUE (codigo),
	CONSTRAINT subcategoria_nombre_unico UNIQUE (categoria_id, nombre),
	CONSTRAINT subcategoria_pkey PRIMARY KEY (id),
	CONSTRAINT subcategoria_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.categoria(id) ON DELETE RESTRICT
);`,
  },
  {
    nombre: 'cuenta',
    sql: `
CREATE TABLE IF NOT EXISTS public.cuenta (
	id serial4 NOT NULL,
	nombre varchar(255) NOT NULL,
	tipo varchar(20) NOT NULL,
	moneda_id int4 NOT NULL,
	banco_nombre varchar(100) NULL,
	numero_cuenta varchar(50) NULL,
	saldo_inicial numeric(18, 2) DEFAULT 0 NOT NULL,
	activo bool DEFAULT true NOT NULL,
	creado_en timestamptz DEFAULT now() NULL,
	actualizado_en timestamptz DEFAULT now() NULL,
	permite_lanzamiento_tarjeta bool NULL,
	CONSTRAINT cuenta_pkey PRIMARY KEY (id),
	CONSTRAINT cuenta_tipo_check CHECK (((tipo)::text = ANY (ARRAY[('Efectivo'::character varying)::text, ('Banco'::character varying)::text]))),
	CONSTRAINT cuenta_moneda_id_fkey FOREIGN KEY (moneda_id) REFERENCES public.moneda(id) ON DELETE RESTRICT
);`,
  },
    {
    nombre: 'tipo_cambio',
    sql: `
CREATE TABLE IF NOT EXISTS public.tipo_cambio (
	id serial4 NOT NULL,
	moneda_origen int4 NOT NULL,
	moneda_destino int4 NOT NULL,
	valor numeric(18, 4) NOT NULL,
	fecha date NOT NULL,
	activo bool DEFAULT true NULL,
	creado_en timestamptz DEFAULT now() NULL,
	grupo_id uuid NULL,
	CONSTRAINT tipo_cambio_pkey PRIMARY KEY (id),
	CONSTRAINT tipo_cambio_destino_fk FOREIGN KEY (moneda_destino) REFERENCES public.moneda(id) ON DELETE CASCADE,
	CONSTRAINT tipo_cambio_origen_fk FOREIGN KEY (moneda_origen) REFERENCES public.moneda(id) ON DELETE CASCADE
);`,
  },
  {
    nombre: 'empresa',
    sql: `
CREATE TABLE IF NOT EXISTS public.empresa (
	id serial4 NOT NULL,
	ruc varchar(20) NOT NULL,
	fantasia varchar(255) NOT NULL,
	razon_social varchar(255) NOT NULL,
	direccion varchar(500) NULL,
	telefono varchar(20) NULL,
	email varchar(100) NULL,
	ciudad varchar(100) NULL,
	departamento varchar(100) NULL,
	pais varchar(100) DEFAULT 'Paraguay'::character varying NULL,
	moneda_base int4 NOT NULL,
	id_csc numeric NULL,
	csc varchar(100) NULL,
	contrasena_certificado varchar(255) NULL,
	regimen_contable varchar(100) NULL,
	cliente_predeterminado int8 NULL,
	operacion_preseleccionada_venta int8 NULL,
	operacion_preseleccionada_nota_fiscal int8 NULL,
	activo bool DEFAULT true NOT NULL,
	creado_en timestamptz DEFAULT now() NULL,
	actualizado_en timestamptz DEFAULT now() NULL,
	operacion_preseleccionada_compra int8 NULL,
	actividad_economica json NULL,
	operacion_preseleccionada_ingreso int8 NULL,
	operacion_preseleccionada_gasto int8 NULL,
	CONSTRAINT empresa_pkey PRIMARY KEY (id),
	CONSTRAINT empresa_ruc_key UNIQUE (ruc),
	CONSTRAINT empresa_moneda_fk FOREIGN KEY (moneda_base) REFERENCES public.moneda(id)
);`,
  },
  {
    nombre: 'persona',
    sql: `
CREATE TABLE IF NOT EXISTS public.persona (
	id bigserial NOT NULL,
	tipo_persona varchar(50) NOT NULL,
	nombre varchar(255) NOT NULL,
	razon_social varchar(255) NULL,
	cedula numeric NULL,
	ruc varchar(50) NULL,
	email varchar(100) NULL,
	telefono varchar(20) NULL,
	direccion varchar(500) NULL,
	ciudad varchar(100) NULL,
	departamento varchar(100) NULL,
	pais varchar(100) DEFAULT 'Paraguay'::character varying NULL,
	categoria varchar(50) NULL,
	activo bool DEFAULT true NOT NULL,
	creado_en timestamptz DEFAULT now() NULL,
	actualizado_en timestamptz DEFAULT now() NULL,
	observacion varchar(255) NULL,
	limite_credito numeric(18, 2) NULL,
	CONSTRAINT persona_cedula_key UNIQUE (cedula),
	CONSTRAINT persona_pkey PRIMARY KEY (id),
	CONSTRAINT persona_ruc_key UNIQUE (ruc),
	CONSTRAINT persona_tipo_persona_check CHECK (((tipo_persona)::text = ANY (ARRAY[('Física'::character varying)::text, ('Jurídica'::character varying)::text])))
);`,
  },
  {
    nombre: 'credito_persona_movimiento',
    sql: `
CREATE TABLE IF NOT EXISTS public.credito_persona_movimiento (
	id bigserial NOT NULL,
	grupo_id uuid NOT NULL,
	persona_id int8 NOT NULL,
	moneda_id int4 NOT NULL,
	naturaleza varchar(10) NOT NULL,
	valor numeric(18, 2) NOT NULL,
	cambio numeric(18, 4) NOT NULL,
	valor_convertido numeric(18, 2) NOT NULL,
	tipo varchar(30) DEFAULT 'AJUSTE'::character varying NOT NULL,
	movimiento_id int8 NULL,
	observacion varchar(255) NULL,
	estado varchar(20) DEFAULT 'Efectivado'::character varying NOT NULL,
	creado_por int4 NOT NULL,
	creado_en timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT credito_persona_mov_estado_check CHECK (((estado)::text = ANY ((ARRAY['Efectivado'::character varying, 'Cancelado'::character varying])::text[]))),
	CONSTRAINT credito_persona_mov_naturaleza_check CHECK (((naturaleza)::text = ANY ((ARRAY['Credito'::character varying, 'Debito'::character varying])::text[]))),
	CONSTRAINT credito_persona_mov_pkey PRIMARY KEY (id),
	CONSTRAINT credito_persona_mov_valor_check CHECK ((valor > (0)::numeric)),
	CONSTRAINT credito_persona_mov_moneda_fk FOREIGN KEY (moneda_id) REFERENCES public.moneda(id),
	CONSTRAINT credito_persona_mov_movimiento_fk FOREIGN KEY (movimiento_id) REFERENCES public.movimientos(id) ON DELETE SET NULL,
	CONSTRAINT credito_persona_mov_persona_fk FOREIGN KEY (persona_id) REFERENCES public.persona(id) ON DELETE RESTRICT,
	CONSTRAINT credito_persona_mov_usuario_fk FOREIGN KEY (creado_por) REFERENCES public.usuarios(id)
);
CREATE INDEX idx_credito_persona_grupo ON public.credito_persona_movimiento USING btree (grupo_id);
CREATE INDEX idx_credito_persona_persona ON public.credito_persona_movimiento USING btree (persona_id, moneda_id) WHERE ((estado)::text = 'Efectivado'::text);`,
  },
  {
    nombre: 'movimientos',
    sql: `
CREATE TABLE IF NOT EXISTS public.movimientos (
	id bigserial NOT NULL,
	creado_en timestamptz DEFAULT now() NULL,
	caja_id int4 NOT NULL,
	fecha timestamptz NULL,
	usuario_id int4 NOT NULL,
	estado varchar(50) NULL,
	motivo_cancelado varchar(255) NULL,
	observacion varchar(255) NULL,
	moneda_id int4 NULL,
	tipo_movimiento varchar(100) NULL,
	CONSTRAINT movimientos_pkey PRIMARY KEY (id),
	CONSTRAINT movimientos_caja_id_fkey FOREIGN KEY (caja_id) REFERENCES public.cajas(id) ON DELETE CASCADE,
	CONSTRAINT movimientos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE
);`,
  },
  {
    nombre: 'bajas',
    sql: `
CREATE TABLE IF NOT EXISTS public.bajas (
	id bigserial NOT NULL,
	movimiento_id int4 NOT NULL,
	operacion varchar(100) NOT NULL,
	moneda_id int4 NULL,
	cuenta_id int4 NULL,
	valor numeric(18, 2) NULL,
	cambio numeric(18, 2) NULL,
	valor_contable numeric(18, 2) NULL,
	titulo_id int4 NULL,
	documento_id int4 NULL,
	persona_id int4 NULL,
	categoria_id int4 NULL,
	compensado bool NULL,
	fecha_compensacion timestamptz NULL,
	vencimiento date NULL,
	valor_convertido numeric(18, 2) NULL,
	interes numeric(18, 2) NULL,
	descuento numeric(18, 2) NULL,
	documento varchar(20) NULL,
	emision timestamptz NULL,
	observacion varchar(255) NULL,
	valor_liquido numeric(18, 2) NULL,
	naturaleza_financiera varchar(50) NULL,
	observacion_auto varchar(255) NULL,
	forma_pago varchar(100) NULL,
	CONSTRAINT bajas_pkey PRIMARY KEY (id),
	CONSTRAINT bajas_moneda_id_fkey FOREIGN KEY (moneda_id) REFERENCES public.moneda(id) ON DELETE CASCADE,
	CONSTRAINT bajas_movimiento_id_fkey FOREIGN KEY (movimiento_id) REFERENCES public.movimientos(id) ON DELETE CASCADE
);`,
  },
  {
    nombre: 'bajas_caja',
    sql: `
CREATE TABLE IF NOT EXISTS public.bajas_caja (
	id bigserial NOT NULL,
	movimiento_id int4 NOT NULL,
	moneda_id int4 NULL,
	caja_id int4 NULL,
	valor numeric(18, 2) NULL,
	vuelto numeric(18, 2) NULL,
	cambio numeric(18, 2) NULL,
	valor_contable numeric(18, 2) NULL,
	naturaleza_financiera varchar(50) NULL,
	forma_pago varchar(100) NULL,
	CONSTRAINT bajas_caja_pkey PRIMARY KEY (id),
	CONSTRAINT bajas_caja_caja_id_fkey FOREIGN KEY (caja_id) REFERENCES public.cajas(id) ON DELETE CASCADE,
	CONSTRAINT bajas_caja_moneda_id_fkey FOREIGN KEY (moneda_id) REFERENCES public.moneda(id) ON DELETE CASCADE,
	CONSTRAINT bajas_caja_movimiento_id_fkey FOREIGN KEY (movimiento_id) REFERENCES public.movimientos(id) ON DELETE CASCADE
);`,
  },
  {
    nombre: 'documentos',
    sql: `
CREATE TABLE IF NOT EXISTS public.documentos (
	id bigserial NOT NULL,
	movimiento_id int4 NOT NULL,
	baja_id int4 NULL,
	naturaleza_contable varchar(50) NULL,
	tipo_documento varchar(100) NULL,
	condicion_documento varchar(100) NULL,
	numero_documento varchar(50) NULL,
	gravadas_0 numeric(18, 2) NULL,
	gravadas_5 numeric(18, 2) NULL,
	gravadas_10 numeric(18, 2) NULL,
	iva_0 numeric(18, 2) NULL,
	iva_5 numeric(18, 2) NULL,
	iva_10 numeric(18, 2) NULL,
	valor_documento numeric(18, 2) NULL,
	CONSTRAINT documentos_pkey PRIMARY KEY (id),
	CONSTRAINT documentos_baja_id_fkey FOREIGN KEY (baja_id) REFERENCES public.bajas(id) ON DELETE CASCADE,
	CONSTRAINT documentos_movimiento_id_fkey FOREIGN KEY (movimiento_id) REFERENCES public.movimientos(id) ON DELETE CASCADE
);`,
  },
  {
    nombre: 'operaciones_baja',
    sql: `
CREATE TABLE IF NOT EXISTS public.operaciones_baja (
	id serial4 NOT NULL,
	descripcion varchar(200) NOT NULL,
	modulo varchar(50) NOT NULL,
	tipo_operacion varchar(50) NOT NULL,
	naturaleza_financiera varchar(50) NOT NULL,
	genera_documento_legal bool DEFAULT true NULL,
	timbrado varchar(50) NULL,
	exige_persona bool DEFAULT true NULL,
	exige_categoria bool DEFAULT false NULL,
	exige_articulos bool DEFAULT false NULL,
	exige_almacen bool DEFAULT false NULL,
	genera_movimiento_stock bool DEFAULT false NULL,
	tipo_movimiento_stock varchar(50) NULL,
	genera_movimiento_financiero_categoria bool DEFAULT false NULL,
	genera_movimiento_financiero_cuenta bool DEFAULT false NULL,
	activo bool DEFAULT true NOT NULL,
	creado_en timestamptz DEFAULT now() NULL,
	categoria_id int8 NULL,
	almacen_id int8 NULL,
	tipo_cuenta varchar(100) NULL,
	CONSTRAINT operaciones_baja_pkey PRIMARY KEY (id)
);`,
  },
  {
    nombre: 'asiento',
    sql: `
CREATE TABLE IF NOT EXISTS public.asiento (
	id bigserial NOT NULL,
	movimiento_id int8 NULL,
	tipo_asiento varchar(20) NOT NULL,
	caja_id int4 NULL,
	cuenta_id int4 NULL,
	subcategoria_id int4 NULL,
	naturaleza varchar(10) NOT NULL,
	moneda_id int4 NOT NULL,
	valor numeric(18, 2) NOT NULL,
	tipo_cambio_id int4 NULL,
	cambio numeric(18, 4) NULL,
	valor_convertido numeric(18, 2) NULL,
	valor_contable numeric(18, 2) NOT NULL,
	persona_id int4 NULL,
	titulo_id int4 NULL,
	documento_id int4 NULL,
	documento varchar(20) NULL,
	vencimiento date NULL,
	historico varchar(500) NULL,
	emision timestamptz DEFAULT now() NOT NULL,
	compensacion timestamptz NULL,
	fecha_contable date DEFAULT CURRENT_DATE NOT NULL,
	estado varchar(20) DEFAULT 'Efectivado'::character varying NOT NULL,
	fecha_cancelacion timestamptz NULL,
	motivo_cancelacion varchar(255) NULL,
	cancelado_por int4 NULL,
	creado_por int4 NOT NULL,
	creado_en timestamptz DEFAULT now() NOT NULL,
	actualizado_por int4 NULL,
	actualizado_en timestamptz NULL,
	forma_pago varchar(100) NULL,
	caja_movimiento int8 NULL,
	grupo_id uuid NULL,
	CONSTRAINT as_subcategoria_segun_tipo CHECK ((((tipo_asiento)::text = ANY ((ARRAY['PAGO'::character varying, 'RECIBIMIENTO'::character varying])::text[])) = (subcategoria_id IS NOT NULL))),
	CONSTRAINT as_un_contenedor CHECK ((num_nonnulls(caja_id, cuenta_id) = 1)),
	CONSTRAINT as_valor_contable_coherente CHECK (((valor_convertido IS NOT NULL) OR (valor_contable = valor))),
	CONSTRAINT asiento_estado_check CHECK (((estado)::text = ANY (ARRAY[('Efectivado'::character varying)::text, ('Cancelado'::character varying)::text]))),
	CONSTRAINT asiento_naturaleza_check CHECK (((naturaleza)::text = ANY ((ARRAY['Débito'::character varying, 'Crédito'::character varying])::text[]))),
	CONSTRAINT asiento_pkey PRIMARY KEY (id),
	CONSTRAINT asiento_valor_check CHECK ((valor > (0)::numeric)),
	CONSTRAINT asiento_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES public.usuarios(id),
	CONSTRAINT asiento_caja_id_fkey FOREIGN KEY (caja_id) REFERENCES public.cajas(id) ON DELETE RESTRICT,
	CONSTRAINT asiento_cancelado_por_fkey FOREIGN KEY (cancelado_por) REFERENCES public.usuarios(id),
	CONSTRAINT asiento_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES public.usuarios(id),
	CONSTRAINT asiento_cuenta_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuenta(id) ON DELETE RESTRICT,
	CONSTRAINT asiento_moneda_id_fkey FOREIGN KEY (moneda_id) REFERENCES public.moneda(id),
	CONSTRAINT asiento_tipo_cambio_id_fkey FOREIGN KEY (tipo_cambio_id) REFERENCES public.tipo_cambio(id)
);`,
  },
];

// ============================================
// ÍNDICES
// ============================================

const INDICES: { nombre: string; sql: string }[] = [
  { nombre: 'moneda', sql: `CREATE INDEX IF NOT EXISTS moneda_codigo_idx ON public.moneda USING btree (codigo);` },
  { nombre: 'tipo_cambio', sql: `CREATE INDEX IF NOT EXISTS tipo_cambio_destino_idx ON public.tipo_cambio USING btree (moneda_destino);` },
  { nombre: 'tipo_cambio', sql: `CREATE INDEX IF NOT EXISTS tipo_cambio_origen_idx ON public.tipo_cambio USING btree (moneda_origen);` },
  { nombre: 'subcategoria_ingreso', sql: `CREATE INDEX IF NOT EXISTS idx_subcategoria_categoria ON public.subcategoria_ingreso USING btree (categoria_id);` },
  { nombre: 'persona', sql: `CREATE INDEX IF NOT EXISTS idx_persona_cedula ON public.persona USING btree (cedula);` },
  { nombre: 'persona', sql: `CREATE INDEX IF NOT EXISTS idx_persona_ruc ON public.persona USING btree (ruc);` },
  { nombre: 'operaciones_baja', sql: `CREATE INDEX IF NOT EXISTS idx_operaciones_modulo ON public.operaciones_baja USING btree (modulo);` },
  { nombre: 'usuarios', sql: `CREATE UNIQUE INDEX IF NOT EXISTS usuarios_un_solo_master ON public.usuarios (es_usuario_master) WHERE es_usuario_master = true;` },
  { nombre: 'asiento', sql: `CREATE INDEX IF NOT EXISTS idx_as_caja ON public.asiento USING btree (caja_id, moneda_id) WHERE ((estado)::text = 'EFETIVADO'::text);` },
  { nombre: 'asiento', sql: `CREATE INDEX IF NOT EXISTS idx_as_cuenta ON public.asiento USING btree (cuenta_id, moneda_id) WHERE ((estado)::text = 'EFETIVADO'::text);` },
  { nombre: 'asiento', sql: `CREATE INDEX IF NOT EXISTS idx_as_fecha ON public.asiento USING btree (fecha_contable);` },
  { nombre: 'asiento', sql: `CREATE INDEX IF NOT EXISTS idx_as_movimiento ON public.asiento USING btree (movimiento_id) WHERE (movimiento_id IS NOT NULL);` },
  { nombre: 'asiento', sql: `CREATE INDEX IF NOT EXISTS idx_as_subcategoria ON public.asiento USING btree (subcategoria_id, fecha_contable) WHERE ((estado)::text = 'EFETIVADO'::text);` },
  { nombre: 'asiento', sql: `CREATE INDEX IF NOT EXISTS idx_asiento_grupo_id ON public.asiento USING btree (grupo_id);` },
];

// ============================================
// DATOS INICIALES
// ============================================

const GRUPO_ADMINISTRADOR_NOMBRE = 'Administrador';

/**
 * Inserta las monedas iniciales (PYG, USD, BRL) en ese orden exacto,
 * solo si la tabla moneda está vacía. Así los IDs quedan 1, 2 y 3.
 */
export const crearMonedasIniciales = async () => {
  const existentes = await query('SELECT COUNT(*)::int AS count FROM moneda');
  if (existentes.rows[0].count > 0) {
    console.log('   ℹ️  Monedas ya existen');
    return;
  }

  await query(`
    INSERT INTO moneda (codigo, nombre, simbolo, decimales, activo) VALUES
      ('PYG', 'Guaraní Paraguayo', '₲', 0, TRUE),
      ('USD', 'Dólar Estadounidense', '$', 2, TRUE),
      ('BRL', 'Real Brasileño', 'R$', 2, TRUE)
  `);
  console.log('   ✓ Monedas creadas (PYG, USD, BRL)');
};

/**
 * Crea el grupo "Administrador" con todos los permisos, si no existe.
 * No modifica el grupo si ya existe, para respetar cambios hechos en la app.
 */
export const crearGrupoAdministrador = async () => {
  await query(
    `INSERT INTO grupo_privilegios (nombre, privilegios)
     SELECT $1::varchar, $2::json
     WHERE NOT EXISTS (SELECT 1 FROM grupo_privilegios WHERE nombre = $1::varchar)`,
    [GRUPO_ADMINISTRADOR_NOMBRE, JSON.stringify(PRIVILEGIOS_ADMINISTRADOR)]
  );
  console.log('   ✓ Grupo Administrador verificado');
};

/**
 * Crea el usuario master si todavía no existe ninguno.
 * Los datos se toman de variables de entorno: MASTER_EMAIL, MASTER_PASSWORD y
 * MASTER_NOMBRE (opcional, por defecto "Anderson Pott").
 */
export const crearUsuarioMaster = async () => {
  const email = process.env.MASTER_EMAIL;
  const contrasena = process.env.MASTER_PASSWORD;
  const nombre = process.env.MASTER_NOMBRE || 'Anderson Pott';

  const existe = await query(
    'SELECT 1 FROM usuarios WHERE es_usuario_master = true LIMIT 1'
  );
  if (existe.rows.length > 0) {
    console.log('   ℹ️  Usuario master ya existe');
    return;
  }

  if (!email || !contrasena) {
    console.warn('   ⚠️  Falta MASTER_EMAIL o MASTER_PASSWORD: no se creó el usuario master');
    return;
  }

  const hash = await bcrypt.hash(contrasena, 10);
  await query(
    `INSERT INTO usuarios (nombre, email, contrasena, grupo_privilegios, activo, es_usuario_master)
     VALUES ($1, $2, $3,
       (SELECT id FROM grupo_privilegios WHERE nombre = $4::varchar),
       TRUE, TRUE)`,
    [nombre, email, hash, GRUPO_ADMINISTRADOR_NOMBRE]
  );
  console.log(`   ✓ Usuario master creado: ${nombre} (${email})`);
};

// ============================================
// INICIALIZACIÓN
// ============================================

/**
 * Crea las tablas, los índices, el grupo Administrador y el usuario master.
 * Es seguro ejecutarlo en cada arranque: no duplica datos existentes.
 */
export const initializeDatabase = async () => {
  console.log('\n⏳ Creando estructura de base de datos...\n');

  for (const tabla of TABLAS) {
    try {
      await query(tabla.sql);
      console.log(`   ✓ Tabla ${tabla.nombre} creada`);
    } catch (error) {
      console.error(`   ❌ Error creando tabla ${tabla.nombre}:`, error);
      throw error;
    }
  }

  for (const indice of INDICES) {
    try {
      await query(indice.sql);
    } catch (error) {
      console.warn(`   ⚠️  Error creando índice de ${indice.nombre}:`, error);
    }
  }
  console.log('   ✓ Índices creados');

  console.log('\n📌 Datos iniciales...');
  await crearMonedasIniciales();
  await crearGrupoAdministrador();
  await crearUsuarioMaster();

  console.log('\n✅ Base de datos inicializada completamente.\n');
};