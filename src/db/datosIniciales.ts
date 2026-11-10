import { query } from './db.js';
import bcrypt from 'bcrypt';

// ============================================
// Valores permitidos (alineados con los tipos TypeScript)
// ============================================

const TIPOS_CUENTA_ESPECIFICO = ['Caja', 'Banco', 'Inversión', 'Cobrar', 'Pagar', 'Proveedor', 'Raiz', 'Otro'];
const NIVEL_MAXIMO_PLAN_CUENTAS = 4;

// ============================================
// PASO 1: Tablas sin dependencias
// ============================================

const MONEDA_TABLE = `
CREATE TABLE IF NOT EXISTS moneda (
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
);
`;

const MONEDA_INDICES = `
CREATE INDEX IF NOT EXISTS moneda_codigo_idx ON public.moneda USING btree (codigo);
`;

const GRUPO_PRIVILEGIOS_TABLE = `
CREATE TABLE IF NOT EXISTS grupo_privilegios (
	id serial4 NOT NULL,
	nombre varchar(255) NOT NULL,
	privilegios json NULL,
	creado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT grupo_privilegios_nombre_key UNIQUE (nombre),
	CONSTRAINT grupo_privilegios_pkey PRIMARY KEY (id)
);
`;

const USUARIOS_TABLE = `
CREATE TABLE IF NOT EXISTS usuarios (
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
	CONSTRAINT usuarios_theme_mode_check CHECK (((theme_mode)::text = ANY ((ARRAY['light'::character varying, 'dark'::character varying])::text[])))
);
`;

const CATEGORIAS_GASTO_INGRESO_TABLE = `
CREATE TABLE IF NOT EXISTS categorias_gasto_ingreso (
	id serial4 NOT NULL,
	nombre varchar(255) NOT NULL,
	tipo varchar(50) NOT NULL,
	descripcion text NULL,
	activo bool DEFAULT true NULL,
	subtipo varchar(100) NULL,
	creado_en timestamptz DEFAULT now() NULL,
	actualizado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT categorias_gasto_ingreso_nombre_key UNIQUE (nombre),
	CONSTRAINT categorias_gasto_ingreso_pkey PRIMARY KEY (id),
	CONSTRAINT categorias_gasto_ingreso_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Gasto'::character varying, 'Ingreso'::character varying])::text[])))
);
`;

const CATEGORIAS_GASTO_INGRESO_INDICES = `
CREATE INDEX IF NOT EXISTS categorias_gasto_ingreso_activo_idx ON public.categorias_gasto_ingreso USING btree (activo);
CREATE INDEX IF NOT EXISTS categorias_gasto_ingreso_tipo_idx ON public.categorias_gasto_ingreso USING btree (tipo);
`;

const ALMACEN_TABLE = `
CREATE TABLE IF NOT EXISTS almacen (
	id serial4 NOT NULL,
	codigo varchar(50) NOT NULL,
	nombre varchar(100) NOT NULL,
	descripcion text NULL,
	activo bool DEFAULT true NOT NULL,
	creado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT almacen_codigo_key UNIQUE (codigo),
	CONSTRAINT almacen_pkey PRIMARY KEY (id)
);
`;

const OPERACIONES_TABLE = `
CREATE TABLE IF NOT EXISTS operaciones_baja (
	id serial4 NOT NULL,
	descripcion varchar(200) NOT NULL,
	modulo varchar(50) NOT NULL,
	tipo_operacion varchar(50) NOT NULL,
	naturaleza_financiera varchar(50) NOT NULL,
	genera_documento_legal bool DEFAULT true NULL,
  tipo_cuenta varchar(100) NULL,
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
	CONSTRAINT operaciones_baja_modulo_check CHECK (((modulo)::text = ANY ((ARRAY['Venta'::character varying, 'Financiero'::character varying, 'Compra'::character varying])::text[]))),
	CONSTRAINT operaciones_baja_naturaleza_check CHECK (((naturaleza_financiera)::text = ANY ((ARRAY['Entrada'::character varying, 'Salida'::character varying])::text[]))),
	CONSTRAINT operaciones_baja_pkey PRIMARY KEY (id)
);
`;

const OPERACIONES_INDICES = `
CREATE INDEX IF NOT EXISTS idx_operaciones_modulo ON public.operaciones_baja USING btree (modulo);
`;

// ============================================
// PASO 2: Tablas que dependen solo de MONEDA
// ============================================

const TIPO_CAMBIO_TABLE = `
CREATE TABLE IF NOT EXISTS tipo_cambio (
	id serial4 NOT NULL,
	moneda_origen int4 NOT NULL,
	moneda_destino int4 NOT NULL,
	valor numeric(18, 4) NOT NULL,
	fecha date NOT NULL,
	activo bool DEFAULT true NULL,
	creado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT tipo_cambio_pkey PRIMARY KEY (id),
	CONSTRAINT tipo_cambio_destino_fk FOREIGN KEY (moneda_destino) REFERENCES public.moneda(id) ON DELETE CASCADE,
	CONSTRAINT tipo_cambio_origen_fk FOREIGN KEY (moneda_origen) REFERENCES public.moneda(id) ON DELETE CASCADE
);
`;

const TIPO_CAMBIO_INDICES = `
CREATE INDEX IF NOT EXISTS tipo_cambio_origen_idx ON tipo_cambio (moneda_origen);
CREATE INDEX IF NOT EXISTS tipo_cambio_destino_idx ON tipo_cambio (moneda_destino);
`;

const PLAN_CUENTAS_TABLE = `
CREATE TABLE IF NOT EXISTS plan_cuentas (
	id serial4 NOT NULL,
	codigo varchar(50) NOT NULL UNIQUE,
	nombre varchar(255) NOT NULL,
	tipo varchar(50) NOT NULL,
	naturaleza varchar(20) NOT NULL DEFAULT 'Deudora',
	tipo_contable varchar(20) NOT NULL DEFAULT 'Analítica',
	tipo_cuenta_especifico varchar(50) NULL,
	nivel int2 NOT NULL DEFAULT 1,
	cuenta_padre_id int4 NULL,
	descripcion text NULL,
	banco_nombre varchar(100) NULL,
	numero_cuenta varchar(50) NULL,
	moneda_id int4 NULL,
	activo bool DEFAULT true,
	creado_en timestamptz DEFAULT now(),
	actualizado_en timestamptz DEFAULT now(),
	CONSTRAINT plan_cuentas_pkey PRIMARY KEY (id),
	CONSTRAINT plan_cuentas_fk_padre FOREIGN KEY (cuenta_padre_id) REFERENCES public.plan_cuentas(id) ON DELETE CASCADE,
	CONSTRAINT plan_cuentas_moneda_fk FOREIGN KEY (moneda_id) REFERENCES public.moneda(id) ON DELETE SET NULL,
	CONSTRAINT plan_cuentas_tipo_check CHECK (tipo IN ('Activo', 'Pasivo', 'Capital', 'Ingreso', 'Gasto')),
	CONSTRAINT plan_cuentas_naturaleza_check CHECK (naturaleza IN ('Deudora', 'Acreedora')),
	CONSTRAINT plan_cuentas_tipo_contable_check CHECK (tipo_contable IN ('Sintética', 'Analítica')),
	CONSTRAINT plan_cuentas_tipo_especifico_check CHECK (tipo_cuenta_especifico IN ('Caja', 'Banco', 'Inversión', 'Cobrar', 'Pagar', 'Proveedor', 'Raiz', 'Gasto', 'Ingreso', 'Capital')),
	CONSTRAINT plan_cuentas_nivel_check CHECK (nivel BETWEEN 1 AND ${NIVEL_MAXIMO_PLAN_CUENTAS})
);
`;

// Migración para bases ya creadas con los constraints anteriores
/* const PLAN_CUENTAS_MIGRACION = `
ALTER TABLE plan_cuentas DROP CONSTRAINT IF EXISTS plan_cuentas_tipo_especifico_check;
ALTER TABLE plan_cuentas ADD CONSTRAINT plan_cuentas_tipo_especifico_check
  CHECK (tipo_cuenta_especifico IN ('Caja', 'Banco', 'Inversión', 'Cobrar', 'Pagar', 'Proveedor', 'Raiz', 'Gasto', 'Ingreso', 'Capital'));
ALTER TABLE plan_cuentas DROP CONSTRAINT IF EXISTS plan_cuentas_nivel_check;
ALTER TABLE plan_cuentas ADD CONSTRAINT plan_cuentas_nivel_check
  CHECK (nivel BETWEEN 1 AND ${NIVEL_MAXIMO_PLAN_CUENTAS});
`; */

const PLAN_CUENTAS_INDICES = `
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_codigo ON public.plan_cuentas(codigo);
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_tipo ON public.plan_cuentas(tipo);
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_tipo_contable ON public.plan_cuentas(tipo_contable);
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_padre ON public.plan_cuentas(cuenta_padre_id);
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_activo ON public.plan_cuentas(activo);
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_tipo_especifico ON public.plan_cuentas(tipo_cuenta_especifico);
`;

const EMPRESA_TABLE = `
CREATE TABLE IF NOT EXISTS empresa (
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
);
`;

const TIMBRADO_TABLE = `
CREATE TABLE IF NOT EXISTS timbrado (
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
);
`;

const CAJAS_TABLE = `
CREATE TABLE IF NOT EXISTS cajas (
	id serial4 NOT NULL,
	apertura timestamptz NULL,
	cierre timestamptz NULL,
	descripcion varchar(255) NULL,
	estado varchar(50) NULL,
	usuario_id int8 NULL,
	creado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT cajas_pkey PRIMARY KEY (id)
);
`;

// ============================================
// PASO 3: Tablas de artículos y categorías
// ============================================

const CATEGORIAS_ARTICULO_TABLE = `
CREATE TABLE IF NOT EXISTS categoria_articulo (
	id serial4 NOT NULL,
	nombre varchar(100) NOT NULL,
	descripcion text NULL,
	activo bool DEFAULT true NOT NULL,
	creado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT categoria_articulo_pkey PRIMARY KEY (id)
);
`;

const ARTICULO_TABLE = `
CREATE TABLE IF NOT EXISTS articulo (
	id serial4 NOT NULL,
	codigo varchar(50) NULL,
	nombre varchar(255) NOT NULL,
	descripcion text NULL,
	categoria varchar(100) NULL,
	precio_venta numeric(18, 2) NULL,
	precio_compra numeric(18, 2) NULL,
	stock_minimo numeric(18, 2) NULL,
	iva_porcentaje numeric(5, 2) DEFAULT 10 NULL,
	activo bool DEFAULT true NULL,
	creado_en timestamptz DEFAULT now() NULL,
	actualizado_en timestamptz DEFAULT now() NULL,
	unidad varchar(100) NULL,
	CONSTRAINT articulo_codigo_key UNIQUE (codigo),
	CONSTRAINT articulo_pkey PRIMARY KEY (id)
);
`;

const ARTICULO_INDICES = `
CREATE INDEX IF NOT EXISTS idx_articulo_categoria ON public.articulo USING btree (categoria);
CREATE INDEX IF NOT EXISTS idx_articulo_codigo ON public.articulo USING btree (codigo);
`;

// ============================================
// PASO 4: Tabla de personas
// ============================================

const PERSONA_TABLE = `
CREATE TABLE IF NOT EXISTS persona (
	id bigserial NOT NULL,
	tipo_persona varchar(50) NOT NULL,
	nombre varchar(255) NOT NULL,
	razon_social varchar(255) NULL,
	cedula varchar(50) NULL,
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
	CONSTRAINT persona_cedula_key UNIQUE (cedula),
	CONSTRAINT persona_pkey PRIMARY KEY (id),
	CONSTRAINT persona_ruc_key UNIQUE (ruc),
	CONSTRAINT persona_tipo_persona_check CHECK (((tipo_persona)::text = ANY ((ARRAY['Física'::character varying, 'Jurídica'::character varying])::text[])))
);
`;

const PERSONA_INDICES = `
CREATE INDEX IF NOT EXISTS idx_persona_cedula ON public.persona USING btree (cedula);
CREATE INDEX IF NOT EXISTS idx_persona_ruc ON public.persona USING btree (ruc);
`;

// ============================================
// PASO 5: Tablas de movimientos y stock
// ============================================

const MOVIMIENTOS_TABLE = `
CREATE TABLE IF NOT EXISTS movimientos (
    id BIGSERIAL PRIMARY KEY,
    creado_en TIMESTAMPTZ DEFAULT now(),
    caja_id INT4 NOT NULL,
    fecha TIMESTAMPTZ,
    usuario_id INT4 NOT NULL,
    estado VARCHAR(50),
    motivo_cancelado VARCHAR(255),
    observacion VARCHAR(255),
    moneda_id int4,
    FOREIGN KEY (moneda_id) REFERENCES moneda(id) ON DELETE CASCADE,
    FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);
`;

const BAJAS_TABLE = `
CREATE TABLE IF NOT EXISTS bajas (
    id BIGSERIAL PRIMARY KEY,
    movimiento_id INT4 NOT NULL,
    operacion varchar(100) NOT NULL,
    moneda_id INT4,
    cuenta_id INT4,
    valor NUMERIC(18,2),
    valor_liquido numeric(18, 2),
    cambio NUMERIC(18,2),
    valor_contable NUMERIC(18,2),
    titulo_id INT4,
    documento_id INT4,
    persona_id INT4,
	  categoria_id int4 NOT NULL,
    FOREIGN KEY (movimiento_id) REFERENCES movimientos(id) ON DELETE CASCADE,
    FOREIGN KEY (moneda_id) REFERENCES moneda(id) ON DELETE CASCADE,
    FOREIGN KEY (cuenta_id) REFERENCES plan_cuentas(id) ON DELETE CASCADE,
    FOREIGN KEY (persona_id) REFERENCES persona(id) ON DELETE CASCADE
);
`;

const BAJAS_CAJA_TABLE = `
CREATE TABLE IF NOT EXISTS bajas_caja (
    id BIGSERIAL PRIMARY KEY,
    movimiento_id INT4 NOT NULL,
    moneda_id INT4,
    caja_id INT4,
    valor NUMERIC(18,2),
    vuelto NUMERIC(18,2),
    cambio NUMERIC(18,2),
    valor_contable NUMERIC(18,2),
    FOREIGN KEY (movimiento_id) REFERENCES movimientos(id) ON DELETE CASCADE,
    FOREIGN KEY (moneda_id) REFERENCES moneda(id) ON DELETE CASCADE,
    FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE CASCADE
);
`;

const DOCUMENTOS_TABLE = `
CREATE TABLE IF NOT EXISTS documentos (
    id BIGSERIAL PRIMARY KEY,
    movimiento_id INT4 NOT NULL,
    baja_id INT4,
    naturaleza_contable VARCHAR(50),
    tipo_documento VARCHAR(100),
    condicion_documento VARCHAR(100),
    numero_documento VARCHAR(50),
    gravadas_0 NUMERIC(18,2),
    gravadas_5 NUMERIC(18,2),
    gravadas_10 NUMERIC(18,2),
    iva_0 NUMERIC(18,2),
    iva_5 NUMERIC(18,2),
    iva_10 NUMERIC(18,2),
    valor_documento NUMERIC(18,2),
    
    FOREIGN KEY (movimiento_id) REFERENCES movimientos(id) ON DELETE CASCADE,
    FOREIGN KEY (baja_id) REFERENCES bajas(id) ON DELETE CASCADE
);
`;

const MOVIMIENTO_STOCK_TABLE = `
CREATE TABLE IF NOT EXISTS movimiento_stock (
	id bigserial NOT NULL,
	articulo_id int4 NOT NULL,
	almacen_id int4 NOT NULL,
	tipo_movimiento varchar(50) NOT NULL,
	cantidad numeric(18, 4) NOT NULL,
	costo_unitario numeric(18, 6) NULL,
	documento_tipo varchar(50) NULL,
	documento_id int8 NULL,
	referencia varchar(100) NULL,
	usuario_id int8 NOT NULL,
	creado_en timestamptz DEFAULT now() NULL,
	CONSTRAINT movimiento_stock_pkey PRIMARY KEY (id),
	CONSTRAINT movimiento_stock_almacen_fkey FOREIGN KEY (almacen_id) REFERENCES public.almacen(id) ON DELETE CASCADE,
	CONSTRAINT movimiento_stock_articulo_fkey FOREIGN KEY (articulo_id) REFERENCES public.articulo(id) ON DELETE CASCADE,
	CONSTRAINT movimiento_stock_usuario_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE
);
`;

const MOVIMIENTO_STOCK_INDICES = `
CREATE INDEX IF NOT EXISTS idx_movimiento_stock_articulo ON public.movimiento_stock USING btree (articulo_id);
CREATE INDEX IF NOT EXISTS idx_movimiento_stock_documento ON public.movimiento_stock USING btree (documento_tipo, documento_id);
CREATE INDEX IF NOT EXISTS idx_movimiento_stock_fecha ON public.movimiento_stock USING btree (creado_en);
`;

/**
 * Ejecuta una consulta con mejor manejo de errores
 */
const executeQuery = async (sql: any, stepName: any) => {
  try {
    await query(sql);
    return { success: true, error: null };
  } catch (error) {
    console.error(`   ❌ Error en ${stepName}:`, error);
    return { success: false, error };
  }
};

// ============================================
// Plan de cuentas base (niveles 1 a 3; las cajas y bancos son nivel 4)
// ============================================

const PLAN_CUENTAS_BASE = [
  // ACTIVOS
  { codigo: '1', nombre: 'ACTIVOS', moneda_id: 1, tipo: 'Activo', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 1, descripcion: 'Cuentas de Activo' },
  { codigo: '1.1', nombre: 'ACTIVOS CIRCULANTES', moneda_id: 1, tipo: 'Activo', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Activos de Corto Plazo' },
  { codigo: '1.1.1', nombre: 'Efectivo y Equivalentes', moneda_id: 1, tipo: 'Activo', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 3, descripcion: 'Dinero en caja y equivalentes' },
  { codigo: '1.1.2', nombre: 'Bancos y Equivalentes', moneda_id: 1, tipo: 'Activo', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 3, descripcion: 'Cuentas bancarias y equivalentes' },
  { codigo: '1.1.3', nombre: 'Cuentas por Cobrar', moneda_id: 1, tipo: 'Activo', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Cobrar', nivel: 3, descripcion: 'Derechos de cobro a clientes' },
  { codigo: '1.1.4', nombre: 'Inventarios', moneda_id: 1, tipo: 'Activo', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 3, descripcion: 'Existencias de productos' },
  { codigo: '1.1.5', nombre: 'Otros Activos Circulantes', moneda_id: 1, tipo: 'Activo', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 3, descripcion: 'Otros activos a corto plazo' },
  { codigo: '1.2', nombre: 'ACTIVOS NO CIRCULANTES', moneda_id: 1, tipo: 'Activo', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Activos de Largo Plazo' },
  { codigo: '1.2.1', nombre: 'Propiedad, Planta y Equipo', moneda_id: 1, tipo: 'Activo', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 3, descripcion: 'Bienes fijos' },
  { codigo: '1.2.2', nombre: 'Activos Intangibles', moneda_id: 1, tipo: 'Activo', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 3, descripcion: 'Bienes sin forma física' },
  { codigo: '1.2.3', nombre: 'Inversiones Largo Plazo', moneda_id: 1, tipo: 'Activo', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Inversión', nivel: 3, descripcion: 'Inversiones financieras' },

  // PASIVOS
  { codigo: '2', nombre: 'PASIVOS', moneda_id: 1, tipo: 'Pasivo', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 1, descripcion: 'Cuentas de Pasivo' },
  { codigo: '2.1', nombre: 'PASIVOS CIRCULANTES', moneda_id: 1, tipo: 'Pasivo', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Pasivos a Corto Plazo' },
  { codigo: '2.1.1', nombre: 'Cuentas por Pagar', moneda_id: 1, tipo: 'Pasivo', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Pagar', nivel: 3, descripcion: 'Obligaciones con proveedores' },
  { codigo: '2.1.2', nombre: 'Impuestos por Pagar', moneda_id: 1, tipo: 'Pasivo', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 3, descripcion: 'Obligaciones tributarias' },
  { codigo: '2.1.3', nombre: 'Obligaciones Laborales', moneda_id: 1, tipo: 'Pasivo', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 3, descripcion: 'Pasivos con empleados' },
  { codigo: '2.1.4', nombre: 'Préstamos Corto Plazo', moneda_id: 1, tipo: 'Pasivo', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 3, descripcion: 'Deudas a corto plazo' },
  { codigo: '2.2', nombre: 'PASIVOS NO CIRCULANTES', moneda_id: 1, tipo: 'Pasivo', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Pasivos a Largo Plazo' },
  { codigo: '2.2.1', nombre: 'Préstamos Largo Plazo', moneda_id: 1, tipo: 'Pasivo', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 3, descripcion: 'Deudas a largo plazo' },
  { codigo: '2.2.2', nombre: 'Bonos por Pagar', moneda_id: 1, tipo: 'Pasivo', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 3, descripcion: 'Bonos emitidos' },

  // PATRIMONIO
  { codigo: '3', nombre: 'PATRIMONIO', moneda_id: 1, tipo: 'Capital', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 1, descripcion: 'Cuentas de Capital' },
  { codigo: '3.1', nombre: 'Capital Social', moneda_id: 1, tipo: 'Capital', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Capital de la empresa' },
  { codigo: '3.2', nombre: 'Reservas', moneda_id: 1, tipo: 'Capital', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Fondos reservados' },
  { codigo: '3.3', nombre: 'Resultados Acumulados', moneda_id: 1, tipo: 'Capital', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Ganancias/Pérdidas acumuladas' },

  // INGRESOS
  { codigo: '4', nombre: 'INGRESOS', moneda_id: 1, tipo: 'Ingreso', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 1, descripcion: 'Cuentas de Ingreso' },
  { codigo: '4.1', nombre: 'Ingresos por Ventas', moneda_id: 1, tipo: 'Ingreso', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Ventas de productos/servicios' },
  { codigo: '4.2', nombre: 'Otros Ingresos', moneda_id: 1, tipo: 'Ingreso', naturaleza: 'Acreedora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Ingresos diversos' },

  // GASTOS
  { codigo: '5', nombre: 'GASTOS', moneda_id: 1, tipo: 'Gasto', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 1, descripcion: 'Cuentas de Gasto' },
  { codigo: '5.1', nombre: 'Costo de Ventas', moneda_id: 1, tipo: 'Gasto', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Costo directo de ventas' },
  { codigo: '5.2', nombre: 'Gastos Administrativos', moneda_id: 1, tipo: 'Gasto', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Gastos administrativos' },
  { codigo: '5.3', nombre: 'Gastos de Venta', moneda_id: 1, tipo: 'Gasto', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Gastos comerciales' },
  { codigo: '5.4', nombre: 'Gastos Financieros', moneda_id: 1, tipo: 'Gasto', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Gastos relacionados a financiamiento' },
  { codigo: '5.5', nombre: 'Gastos No Operacionales', moneda_id: 1, tipo: 'Gasto', naturaleza: 'Deudora', tipo_contable: 'Sintética', tipo_especifico: 'Raiz', nivel: 2, descripcion: 'Gastos extraordinarios' },
];

/**
 * Obtiene el código del padre a partir del código de la cuenta.
 * Ej: '1.1.2' -> '1.1'  |  '1' -> null
 */
const codigoPadre = (codigo: string): string | null => {
  const idx = codigo.lastIndexOf('.');
  return idx === -1 ? null : codigo.substring(0, idx);
};

/**
 * Inserta el plan de cuentas principal con su jerarquía (cuenta_padre_id)
 * Se insertan en orden para que el padre exista antes que el hijo.
 */
const insertarPlanCuentas = async () => {
  try {
    console.log('\n📍 Insertando Plan de Cuentas principales...');

    for (const cuenta of PLAN_CUENTAS_BASE) {
      if (cuenta.nivel < 1 || cuenta.nivel > NIVEL_MAXIMO_PLAN_CUENTAS) {
        throw new Error(`Nivel inválido (${cuenta.nivel}) en cuenta ${cuenta.codigo}`);
      }
      if (!TIPOS_CUENTA_ESPECIFICO.includes(cuenta.tipo_especifico)) {
        throw new Error(`tipo_cuenta_especifico inválido en cuenta ${cuenta.codigo}`);
      }

      await query(
        `INSERT INTO plan_cuentas
         (codigo, nombre, tipo, naturaleza, tipo_contable, tipo_cuenta_especifico,
          nivel, cuenta_padre_id, descripcion, activo, moneda_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 (SELECT id FROM plan_cuentas WHERE codigo = $8 LIMIT 1),
                 $9, TRUE, $10)
         ON CONFLICT (codigo) DO NOTHING`,
        [
          cuenta.codigo,
          cuenta.nombre,
          cuenta.tipo,
          cuenta.naturaleza,
          cuenta.tipo_contable,
          cuenta.tipo_especifico,
          cuenta.nivel,
          codigoPadre(cuenta.codigo),
          cuenta.descripcion,
          cuenta.moneda_id
        ]
      );
    }

    console.log('   ✓ Plan de Cuentas insertado');

  } catch (error) {
    console.error('   ❌ Error insertando Plan de Cuentas:', error);
    throw error;
  }
};

/**
 * Crea una cuenta CAJA por moneda, como hija de 1.1.1 (Efectivo y Equivalentes),
 * nivel 4, con código correlativo de 3 dígitos (ej: 1.1.1.001)
 */
const crearCajasPorMoneda = async () => {
  try {
    console.log('\n📍 Creando cuentas de CAJA por moneda...');

    const padreRes = await query(
      `SELECT id, codigo, nivel FROM plan_cuentas WHERE codigo = '1.1.1' LIMIT 1`
    );

    if (padreRes.rows.length === 0) {
      throw new Error("No existe la cuenta padre 1.1.1 (Efectivo y Equivalentes)");
    }

    const padre = padreRes.rows[0];
    const nivelCaja = padre.nivel + 1;

    if (nivelCaja > NIVEL_MAXIMO_PLAN_CUENTAS) {
      throw new Error(`La caja excedería el nivel máximo (${NIVEL_MAXIMO_PLAN_CUENTAS})`);
    }

    const monedasRes = await query(
      'SELECT id, nombre, codigo FROM moneda WHERE activo = TRUE ORDER BY id'
    );

    for (const moneda of monedasRes.rows) {
      // Verificar si ya existe la caja para esta moneda
      const existente = await query(
        `SELECT id FROM plan_cuentas
         WHERE tipo_cuenta_especifico = 'Caja'
         AND moneda_id = $1`,
        [moneda.id]
      );

      if (existente.rows.length > 0) continue;

      // Siguiente número correlativo dentro de la rama 1.1.1
      const ultimoRes = await query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(codigo FROM '[0-9]+$') AS int)), 0) AS ultimo
         FROM plan_cuentas
         WHERE cuenta_padre_id = $1`,
        [padre.id]
      );

      const siguiente = Number(ultimoRes.rows[0].ultimo) + 1;
      const codigoCaja = `${padre.codigo}.${String(siguiente).padStart(3, '0')}`;
      const nombreCaja = `Caja - ${moneda.nombre}`;

      await query(
        `INSERT INTO plan_cuentas
         (codigo, nombre, tipo, naturaleza, tipo_contable, tipo_cuenta_especifico,
          nivel, cuenta_padre_id, moneda_id, descripcion, activo)
         VALUES ($1, $2, 'Activo', 'Deudora', 'Analítica', 'Caja', $3, $4, $5, $6, TRUE)`,
        [codigoCaja, nombreCaja, nivelCaja, padre.id, moneda.id, `Caja de ${moneda.nombre}`]
      );

      console.log(`   ✓ Caja creada: ${codigoCaja} - ${nombreCaja}`);
    }

  } catch (error) {
    console.error('   ❌ Error creando cajas por moneda:', error);
    throw error;
  }
};

/**
 * Inicializa los datos iniciales de la base de datos
 */
const inicializarDatosIniciales = async () => {
  try {
    console.log('\n📌 Creando datos iniciales...');

    // Crear grupo de privilegios
    const privilegioExistenteRes = await query('SELECT * FROM grupo_privilegios LIMIT 1');

    if (privilegioExistenteRes.rows.length === 0) {
      await query(
        `INSERT INTO grupo_privilegios (nombre) VALUES ($1)`,
        ['Administrador']
      );
      console.log('   ✓ Grupo de privilegios Administrador creado');
    } else {
      console.log('   ℹ️  Grupo de privilegios ya existe');
    }

    // Crear usuario admin
    const usuarioExistenteRes = await query('SELECT * FROM usuarios LIMIT 1');

    if (usuarioExistenteRes.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await query(
        `INSERT INTO usuarios (nombre, grupo_privilegios, email, contrasena, activo, es_usuario_master)
         VALUES ($1, $2, $3, $4, TRUE, true)`,
        ['Anderson Pott', 1, 'admin@hysistemas.com', hash]
      );
      console.log('   ✓ Usuario administrador creado');
      console.log('     - Usuario: Anderson Pott');
      console.log('     - Email: admin@hysistemas.com');
      console.log('     - Contraseña: admin123');
    } else {
      console.log('   ℹ️  Usuario administrador ya existe');
    }

    // Crear monedas
    const monedasExistentes = await query('SELECT COUNT(*)::int as count FROM moneda');

    if (monedasExistentes.rows[0].count === 0) {
      await query(`
        INSERT INTO moneda (codigo, nombre, simbolo, decimales, activo) VALUES
          ('PYG', 'Guaraní Paraguayo', '₲', 0, TRUE),
          ('USD', 'Dólar Estadounidense', '$', 2, TRUE),
          ('BRL', 'Real Brasileño', 'R$', 2, TRUE)
      `);
      console.log('   ✓ Monedas creadas (PYG, USD, BRL)');
    } else {
      console.log('   ℹ️  Monedas ya existen');
    }

    // Insertar plan de cuentas
    await insertarPlanCuentas();

    // Crear cajas por moneda
    await crearCajasPorMoneda();

  } catch (error) {
    console.error('❌ Error inicializando datos:', error);
    throw error;
  }
};

// ============================================
// Funciones principales de inicialización
// ============================================

/**
 * Inicializa completamente la base de datos
 * Crea todas las tablas con sus índices
 */
export const initializeDatabase = async () => {
  try {
    console.log('\n⏳ Creando estructura de base de datos...\n');

    // ====== PASO 1: Tablas base sin dependencias ======
    console.log('📌 Paso 1: Creando tablas base...');

    let result = await executeQuery(MONEDA_TABLE, 'moneda');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla moneda creada');

    result = await executeQuery(MONEDA_INDICES, 'moneda_indices');
    if (!result.success) console.warn('   ⚠️  Error creando índices de moneda');
    else console.log('   ✓ Índices de moneda creados');

    result = await executeQuery(GRUPO_PRIVILEGIOS_TABLE, 'grupo_privilegios');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla grupo_privilegios creada');

    result = await executeQuery(USUARIOS_TABLE, 'usuarios');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla usuarios creada');

    result = await executeQuery(ALMACEN_TABLE, 'almacen');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla almacen creada');

    result = await executeQuery(OPERACIONES_TABLE, 'operaciones_baja');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla operaciones_baja creada');

    result = await executeQuery(OPERACIONES_INDICES, 'operaciones_indices');
    if (!result.success) console.warn('   ⚠️  Error creando índices de operaciones');
    else console.log('   ✓ Índices de operaciones creados');

    // ====== PASO 2: Tablas que dependen de MONEDA ======
    console.log('\n📌 Paso 2: Creando tablas dependientes de moneda...');

    result = await executeQuery(TIPO_CAMBIO_TABLE, 'tipo_cambio');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla tipo_cambio creada');

    result = await executeQuery(TIPO_CAMBIO_INDICES, 'tipo_cambio_indices');
    if (!result.success) console.warn('   ⚠️  Error creando índices de tipo_cambio');
    else console.log('   ✓ Índices de tipo_cambio creados');

    result = await executeQuery(PLAN_CUENTAS_TABLE, 'plan_cuentas');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla plan_cuentas creada');
    /* 
        result = await executeQuery(PLAN_CUENTAS_MIGRACION, 'plan_cuentas_migracion');
        if (!result.success) throw result.error;
        console.log('   ✓ Constraints de plan_cuentas actualizados'); */

    result = await executeQuery(PLAN_CUENTAS_INDICES, 'plan_cuentas_indices');
    if (!result.success) console.warn('   ⚠️  Error creando índices de plan_cuentas');
    else console.log('   ✓ Índices de plan_cuentas creados');

    result = await executeQuery(EMPRESA_TABLE, 'empresa');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla empresa creada');

    result = await executeQuery(CAJAS_TABLE, 'cajas');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla cajas creada');

    result = await executeQuery(TIMBRADO_TABLE, 'timbrado');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla timbrado creada');

    // ====== PASO 3: Tablas de artículos ======
    console.log('\n📌 Paso 3: Creando tablas de artículos...');

    result = await executeQuery(CATEGORIAS_ARTICULO_TABLE, 'categoria_articulo');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla categoria_articulo creada');

    result = await executeQuery(ARTICULO_TABLE, 'articulo');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla articulo creada');

    result = await executeQuery(ARTICULO_INDICES, 'articulo_indices');
    if (!result.success) console.warn('   ⚠️  Error creando índices de artículos');
    else console.log('   ✓ Índices de artículos creados');

    // ====== PASO 4: Tabla de personas ======
    console.log('\n📌 Paso 4: Creando tabla de personas...');

    result = await executeQuery(PERSONA_TABLE, 'persona');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla persona creada');

    result = await executeQuery(PERSONA_INDICES, 'persona_indices');
    if (!result.success) console.warn('   ⚠️  Error creando índices de personas');
    else console.log('   ✓ Índices de personas creados');

    // ====== PASO 5: Tablas de movimientos y transacciones ======
    console.log('\n📌 Paso 5: Creando tablas de movimientos y transacciones...');

    result = await executeQuery(MOVIMIENTOS_TABLE, 'movimientos');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla movimientos creada');

    result = await executeQuery(BAJAS_TABLE, 'bajas');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla bajas creada');

    result = await executeQuery(BAJAS_CAJA_TABLE, 'bajas_caja');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla bajas creada');

    result = await executeQuery(DOCUMENTOS_TABLE, 'documentos');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla documentos creada');

    result = await executeQuery(MOVIMIENTO_STOCK_TABLE, 'movimiento_stock');
    if (!result.success) throw result.error;
    console.log('   ✓ Tabla movimiento_stock creada');

    result = await executeQuery(MOVIMIENTO_STOCK_INDICES, 'movimiento_stock_indices');
    if (!result.success) console.warn('   ⚠️  Error creando índices de movimientos');
    else console.log('   ✓ Índices de movimientos creados');

    console.log('\n✅ Estructura de tablas creada exitosamente.\n');

    // Inicializar datos
    await inicializarDatosIniciales();

    console.log('\n✅ Base de datos inicializada completamente.\n');

  } catch (error) {
    console.error('❌ Error inicializando base de datos:', error);
    throw error;
  }
};