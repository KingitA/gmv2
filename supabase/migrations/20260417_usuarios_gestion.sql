-- Migration: Gestión de usuarios multi-tenant
-- Agrega soporte para cambio obligatorio de contraseña en primer login

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE;
