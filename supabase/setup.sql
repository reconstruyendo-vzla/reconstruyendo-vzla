-- ============================================================
-- Reconstruyendo Vzla — configuración Supabase
-- Ejecutar en: Dashboard → SQL Editor → New query → Run
-- ============================================================

-- Tablas (un registro JSON por fila, flexible para todos los campos de la app)
CREATE TABLE IF NOT EXISTS public.personas (
  id TEXT PRIMARY KEY,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.zonas (
  id TEXT PRIMARY KEY,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mascotas (
  id TEXT PRIMARY KEY,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.voluntarios (
  id TEXT PRIMARY KEY,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.donaciones (
  id TEXT PRIMARY KEY,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.refugios (
  id TEXT PRIMARY KEY,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.aliados (
  id TEXT PRIMARY KEY,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Donaciones: forzar verificado = false al insertar/actualizar
CREATE OR REPLACE FUNCTION public.force_donacion_unverified()
RETURNS TRIGGER AS $$
BEGIN
  NEW.record := jsonb_set(COALESCE(NEW.record, '{}'::jsonb), '{verificado}', 'false'::jsonb, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_donaciones_verificado ON public.donaciones;
CREATE TRIGGER trg_donaciones_verificado
  BEFORE INSERT OR UPDATE ON public.donaciones
  FOR EACH ROW EXECUTE FUNCTION public.force_donacion_unverified();

-- Row Level Security
ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zonas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mascotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voluntarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refugios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aliados ENABLE ROW LEVEL SECURITY;

-- Lectura pública (cualquiera puede ver reportes)
CREATE POLICY "personas_select" ON public.personas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "zonas_select" ON public.zonas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "mascotas_select" ON public.mascotas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "voluntarios_select" ON public.voluntarios FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "donaciones_select" ON public.donaciones FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "refugios_select" ON public.refugios FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "aliados_select" ON public.aliados FOR SELECT TO anon, authenticated USING (true);

-- Escritura pública (cualquiera puede crear/actualizar reportes)
CREATE POLICY "personas_insert" ON public.personas FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "zonas_insert" ON public.zonas FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "mascotas_insert" ON public.mascotas FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "voluntarios_insert" ON public.voluntarios FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "donaciones_insert" ON public.donaciones FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "refugios_insert" ON public.refugios FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "aliados_insert" ON public.aliados FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "refugios_update" ON public.refugios FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "refugios_upsert" ON public.refugios FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
