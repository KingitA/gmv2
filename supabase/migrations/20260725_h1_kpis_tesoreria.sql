-- ─────────────────────────────────────────────────────────────────────────────
-- FASE H1 — Vistas de KPIs de tesorería + versionado de vistas huérfanas
--
-- Todas son vistas simples (volúmenes chicos, no hace falta materializar).
-- El tablero /finanzas/tablero solo hace SELECT sobre estas vistas.
--
-- Además: v_saldo_clientes y v_aging_clientes existían SOLO en la base
-- (schema drift) — acá quedan versionadas tal cual están en producción
-- (extraídas con pg_get_viewdef el 24-07-2026). CREATE OR REPLACE no las
-- modifica si ya existen idénticas.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Posición de tesorería: cada cuenta con nombre y saldo ═══
CREATE OR REPLACE VIEW public.v_posicion_tesoreria AS
SELECT s.cuenta_tipo::text AS cuenta_tipo,
       s.cuenta_id,
       COALESCE(cf.nombre, cb.nombre, ci.nombre, 'Billetera ' || COALESCE(v.nombre, left(s.cuenta_id::text, 8))) AS nombre,
       CASE s.cuenta_tipo::text
         WHEN 'CAJA' THEN 'EFECTIVO'
         WHEN 'BANCO' THEN 'BANCOS'
         WHEN 'INVERSION' THEN 'BOLSA'
         ELSE 'BILLETERAS' END AS grupo,
       sum(s.saldo) AS saldo
FROM saldos_financieros s
LEFT JOIN cajas_financieras cf ON s.cuenta_tipo = 'CAJA' AND cf.id = s.cuenta_id
LEFT JOIN cuentas_bancarias cb ON s.cuenta_tipo = 'BANCO' AND cb.id = s.cuenta_id
LEFT JOIN cuentas_inversion ci ON s.cuenta_tipo = 'INVERSION' AND ci.id = s.cuenta_id
LEFT JOIN vendedores v ON s.cuenta_tipo = 'BILLETERA' AND v.id = s.cuenta_id
GROUP BY s.cuenta_tipo, s.cuenta_id, cf.nombre, cb.nombre, ci.nombre, v.nombre;

-- ═══ 2. Cheques en cartera por ventana de vencimiento ═══
CREATE OR REPLACE VIEW public.v_cheques_vencimientos AS
SELECT CASE
         WHEN fecha_vencimiento < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN 'VENCIDO'
         WHEN fecha_vencimiento <= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 7 THEN 'D7'
         WHEN fecha_vencimiento <= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 15 THEN 'D15'
         WHEN fecha_vencimiento <= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 30 THEN 'D30'
         ELSE 'D30MAS' END AS ventana,
       CASE WHEN es_echeq THEN 'ECHEQ' ELSE color::text END AS cartera,
       count(*) AS cantidad,
       sum(monto) AS total
FROM cheques
WHERE tipo = 'TERCERO' AND estado = 'EN_CARTERA'
GROUP BY 1, 2;

-- ═══ 3. Verificación pendiente (cobranzas sin segunda firma) ═══
CREATE OR REPLACE VIEW public.v_verificacion_pendiente AS
SELECT count(*) AS sin_verificar,
       COALESCE(sum(monto), 0) AS monto_sin_verificar,
       max((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - fecha_pago) AS dias_mas_viejo,
       (SELECT count(*) FROM pagos_clientes WHERE estado = 'confirmado') AS total_confirmados
FROM pagos_clientes
WHERE estado = 'confirmado' AND verificado_por IS NULL;

-- ═══ 4. Diferencias de rendición por cobrador ═══
CREATE OR REPLACE VIEW public.v_rendicion_diferencias AS
SELECT r.cobrador_id,
       r.cobrador_tipo,
       COALESCE(v.nombre, left(r.cobrador_id::text, 8)) AS cobrador_nombre,
       count(*) AS rendiciones,
       count(*) FILTER (WHERE abs(COALESCE(r.diferencia, 0)) > 0.01) AS con_diferencia,
       COALESCE(sum(r.diferencia), 0) AS diferencia_acumulada,
       max(r.confirmado_at) AS ultima_rendicion
FROM rendiciones r
LEFT JOIN vendedores v ON v.id = r.cobrador_id
WHERE r.estado = 'confirmada'
GROUP BY r.cobrador_id, r.cobrador_tipo, v.nombre;

-- ═══ 5. Plata en la calle y días de calle por cobrador ═══
-- días = saldo billetera / promedio diario cobrado (últimos 30 días)
CREATE OR REPLACE VIEW public.v_dias_calle AS
SELECT s.cuenta_id AS cobrador_id,
       COALESCE(v.nombre, left(s.cuenta_id::text, 8)) AS cobrador_nombre,
       s.saldo AS en_calle,
       COALESCE(p.cobrado_30d, 0) AS cobrado_30d,
       CASE WHEN COALESCE(p.cobrado_30d, 0) > 0
            THEN round(s.saldo / (p.cobrado_30d / 30.0), 1) END AS dias_calle
FROM saldos_financieros s
LEFT JOIN vendedores v ON v.id = s.cuenta_id
LEFT JOIN LATERAL (
  SELECT sum(pc.monto) AS cobrado_30d
  FROM pagos_clientes pc
  WHERE pc.creado_por = s.cuenta_id
    AND pc.estado IN ('confirmado', 'pendiente_rendicion')
    AND pc.fecha_pago >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - 30
) p ON true
WHERE s.cuenta_tipo = 'BILLETERA' AND s.saldo > 0;

-- ═══ 6. Resumen de cierres de caja (últimos 30) ═══
CREATE OR REPLACE VIEW public.v_cierres_resumen AS
SELECT cc.fecha,
       cf.nombre AS caja,
       cc.saldo_teorico, cc.saldo_contado, cc.diferencia, cc.pagos_verificados
FROM cierres_caja cc
LEFT JOIN cajas_financieras cf ON cf.id = cc.cuenta_id
WHERE cc.estado = 'CONFIRMADO'
ORDER BY cc.fecha DESC
LIMIT 30;

-- ═══ 7. Costo financiero de cheques (gastos de acreditación por mes) ═══
CREATE OR REPLACE VIEW public.v_costo_cheques AS
SELECT date_trunc('month', k.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS mes,
       count(*) AS cheques_acreditados,
       COALESCE(sum(k.gastos), 0) AS gastos_acreditacion,
       COALESCE(sum(k.monto), 0) AS monto_acreditado
FROM kardex_contable k
WHERE k.tipo_movimiento = 'ACREDITACION_CHEQUE' AND k.kardex_reversa_de IS NULL
GROUP BY 1
ORDER BY 1 DESC;

-- ═══ 8. Proyección de caja por semana (12 semanas) ═══
-- Ingresos esperados (cheques en cartera por vencimiento) vs egresos
-- comprometidos (vencimientos pendientes + débito de cheques propios).
CREATE OR REPLACE VIEW public.v_proyeccion_caja AS
WITH semanas AS (
  SELECT generate_series(
    date_trunc('week', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date),
    date_trunc('week', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) + interval '11 weeks',
    interval '1 week'
  )::date AS semana
)
SELECT s.semana,
       COALESCE((SELECT sum(c.monto) FROM cheques c
                 WHERE c.tipo = 'TERCERO' AND c.estado = 'EN_CARTERA'
                   AND c.fecha_vencimiento >= s.semana AND c.fecha_vencimiento < s.semana + 7), 0) AS cheques_a_cobrar,
       COALESCE((SELECT sum(vv.monto) FROM vencimientos vv
                 WHERE vv.estado = 'pendiente'
                   AND vv.fecha_vencimiento >= s.semana AND vv.fecha_vencimiento < s.semana + 7), 0) AS pagos_comprometidos,
       COALESCE((SELECT sum(cp.monto) FROM cheques cp
                 WHERE cp.tipo = 'PROPIO' AND cp.estado = 'ENTREGADO_A_PROVEEDOR' AND cp.fecha_debito IS NULL
                   AND cp.fecha_vencimiento >= s.semana AND cp.fecha_vencimiento < s.semana + 7), 0) AS cheques_propios_a_debitar
FROM semanas s
ORDER BY s.semana;

-- ═══ 9. Versionado de vistas huérfanas (idénticas a producción) ═══
CREATE OR REPLACE VIEW public.v_saldo_clientes AS
SELECT c.id AS cliente_id,
    c.nombre AS cliente_nombre,
    c.cuit,
    c.condicion_pago,
    c.vendedor_id,
    v.nombre AS vendedor_nombre,
    COALESCE(sum(cc.debe), 0::numeric) AS total_debe,
    COALESCE(sum(cc.haber), 0::numeric) AS total_haber,
    COALESCE(sum(cc.debe) - sum(cc.haber), 0::numeric) AS saldo_actual
   FROM clientes c
     LEFT JOIN vendedores v ON v.id = c.vendedor_id
     LEFT JOIN cuenta_corriente_clientes cc ON cc.cliente_id = c.id
  GROUP BY c.id, c.nombre, c.cuit, c.condicion_pago, c.vendedor_id, v.nombre;

CREATE OR REPLACE VIEW public.v_aging_clientes AS
WITH facturas_pendientes AS (
         SELECT cc.cliente_id,
            cc.fecha,
            cc.debe,
            COALESCE(sum(ic.monto_imputado), 0::numeric) AS cobrado,
            cc.debe - COALESCE(sum(ic.monto_imputado), 0::numeric) AS saldo_factura,
            EXTRACT(day FROM now() - cc.fecha)::integer AS dias_antiguedad
           FROM cuenta_corriente_clientes cc
             LEFT JOIN imputaciones_clientes ic ON ic.id_movimiento_factura = cc.id
          WHERE cc.tipo_movimiento::text = 'factura'::text AND cc.debe > 0::numeric
          GROUP BY cc.id, cc.cliente_id, cc.fecha, cc.debe
         HAVING (cc.debe - COALESCE(sum(ic.monto_imputado), 0::numeric)) > 0.01
        )
 SELECT c.id AS cliente_id,
    c.nombre AS cliente_nombre,
    c.vendedor_id,
    v.nombre AS vendedor_nombre,
    cz.zona_id,
    zo.nombre AS zona_nombre,
    COALESCE(sum(fp.saldo_factura) FILTER (WHERE fp.dias_antiguedad < 30), 0::numeric) AS corriente,
    COALESCE(sum(fp.saldo_factura) FILTER (WHERE fp.dias_antiguedad >= 30 AND fp.dias_antiguedad <= 59), 0::numeric) AS dias_30_59,
    COALESCE(sum(fp.saldo_factura) FILTER (WHERE fp.dias_antiguedad >= 60 AND fp.dias_antiguedad <= 89), 0::numeric) AS dias_60_89,
    COALESCE(sum(fp.saldo_factura) FILTER (WHERE fp.dias_antiguedad >= 90), 0::numeric) AS mas_90,
    COALESCE(sum(fp.saldo_factura), 0::numeric) AS saldo_total,
    round(sum(fp.saldo_factura * fp.dias_antiguedad::numeric) / NULLIF(sum(fp.saldo_factura), 0::numeric), 1) AS dias_cobro_promedio
   FROM clientes c
     LEFT JOIN vendedores v ON v.id = c.vendedor_id
     LEFT JOIN clientes_zonas cz ON cz.cliente_id = c.id
     LEFT JOIN zonas zo ON zo.id = cz.zona_id
     LEFT JOIN facturas_pendientes fp ON fp.cliente_id = c.id
  GROUP BY c.id, c.nombre, c.vendedor_id, v.nombre, cz.zona_id, zo.nombre;

-- Permisos de lectura
GRANT SELECT ON public.v_posicion_tesoreria, public.v_cheques_vencimientos,
  public.v_verificacion_pendiente, public.v_rendicion_diferencias,
  public.v_dias_calle, public.v_cierres_resumen, public.v_costo_cheques,
  public.v_proyeccion_caja TO authenticated, service_role;
