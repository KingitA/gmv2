-- REAPERTURA (Juan, 16/11/2026): el reporte de impagos del sistema viejo del 16/11
-- REEMPLAZA a la apertura del 27/10. "Lo anterior no existe más": el que pagó en el
-- sistema viejo ya no figura en el reporte, y lo que no saldó o se le agregó, sí.
--
-- Este script BORRA la apertura anterior (todo lo marcado "APERTURA GM" que se cargó
-- antes del 16/11): comprobantes, entregas a cuenta, ajustes de texto libre y sus
-- renglones del libro. Después se sube el reporte nuevo en /apertura, como la primera
-- vez. Antes de borrar, guarda una copia en el esquema archivo_pruebas.
--
-- Qué había (27/10): 1.290 comprobantes, 71 entregas a cuenta y 1.869 renglones del
-- libro, en 247 clientes. Nada depende de eso (devoluciones, comisiones, remitos,
-- rendiciones, ARCA: 0) salvo 2 imputaciones de un cobro de gmv2 (el cheque de
-- $3.784.286 de FITTERER, prueba): se borran y ese cobro queda a cuenta del cliente.
--
-- Solo toca lo cargado ANTES del 16/11: si se corre de nuevo después de subir el
-- reporte nuevo, no borra la apertura nueva.
--
-- Correrlo en el SQL Editor de Supabase. Todo en una transacción.

BEGIN;

SET LOCAL statement_timeout = '10min';

CREATE SCHEMA IF NOT EXISTS archivo_pruebas;

CREATE TEMP TABLE ap_comp ON COMMIT DROP AS
  SELECT id FROM public.comprobantes_venta
   WHERE observaciones LIKE 'APERTURA GM%' AND created_at < '2026-11-16';
CREATE TEMP TABLE ap_pago ON COMMIT DROP AS
  SELECT id FROM public.pagos_clientes
   WHERE observaciones LIKE 'APERTURA GM%' AND created_at < '2026-11-16';

-- ── Copia antes de borrar ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archivo_pruebas.apertura_20261027_comprobantes AS
  SELECT * FROM public.comprobantes_venta WHERE id IN (SELECT id FROM ap_comp);
CREATE TABLE IF NOT EXISTS archivo_pruebas.apertura_20261027_pagos AS
  SELECT * FROM public.pagos_clientes WHERE id IN (SELECT id FROM ap_pago);
CREATE TABLE IF NOT EXISTS archivo_pruebas.apertura_20261027_libro AS
  SELECT * FROM public.cuenta_corriente_clientes
   WHERE observaciones LIKE 'APERTURA GM%' AND created_at < '2026-11-16';
CREATE TABLE IF NOT EXISTS archivo_pruebas.apertura_20261027_imputaciones AS
  SELECT * FROM public.imputaciones
   WHERE comprobante_id IN (SELECT id FROM ap_comp)
      OR credito_comprobante_id IN (SELECT id FROM ap_comp)
      OR pago_id IN (SELECT id FROM ap_pago);

-- ── Borrado ─────────────────────────────────────────────────────────────────
-- 1. Imputaciones contra la apertura (las 2 del cobro de prueba de FITTERER)
DELETE FROM public.imputaciones
 WHERE comprobante_id IN (SELECT id FROM ap_comp)
    OR credito_comprobante_id IN (SELECT id FROM ap_comp)
    OR pago_id IN (SELECT id FROM ap_pago);

-- 2. Libro: comprobantes, entregas a cuenta y ajustes de texto libre de la apertura
DELETE FROM public.cuenta_corriente_clientes
 WHERE observaciones LIKE 'APERTURA GM%' AND created_at < '2026-11-16';

-- 3. Entregas a cuenta (pagos_detalle y fotos se van en cascada)
DELETE FROM public.pagos_clientes WHERE id IN (SELECT id FROM ap_pago);

-- 4. Comprobantes (su detalle se va en cascada)
DELETE FROM public.comprobantes_venta WHERE id IN (SELECT id FROM ap_comp);

-- ── Control: tiene que dar 0, 0 y 0 ─────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.comprobantes_venta WHERE observaciones LIKE 'APERTURA GM%' AND created_at < '2026-11-16') AS comprobantes,
  (SELECT count(*) FROM public.pagos_clientes WHERE observaciones LIKE 'APERTURA GM%' AND created_at < '2026-11-16') AS a_cuenta,
  (SELECT count(*) FROM public.cuenta_corriente_clientes WHERE observaciones LIKE 'APERTURA GM%' AND created_at < '2026-11-16') AS libro;

COMMIT;
