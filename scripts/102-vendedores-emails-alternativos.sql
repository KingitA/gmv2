-- Agrega campo emails_alternativos a vendedores
-- Permite vincular múltiples mails a un vendedor (separados por espacio)
-- Ejemplo: "mbfreije@hotmail.com otroemail@gmail.com"
ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS emails_alternativos text DEFAULT null;

-- Cargar el mail alternativo de Freije Daniel
UPDATE vendedores 
SET emails_alternativos = 'mbfreije@hotmail.com'
WHERE nombre ILIKE '%FREIJE DANIEL%' AND emails_alternativos IS NULL;
