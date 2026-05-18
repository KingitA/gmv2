-- Warehouse planner: stores layout of shelves and racks in the physical warehouse
CREATE TABLE IF NOT EXISTS warehouse_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Layout Principal',
  warehouse_width numeric NOT NULL DEFAULT 30,
  warehouse_height numeric NOT NULL DEFAULT 40,
  elements jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Only authenticated users can access layouts
ALTER TABLE warehouse_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can manage warehouse layouts"
  ON warehouse_layouts
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Insert default layout so GET always returns a row
INSERT INTO warehouse_layouts (name, warehouse_width, warehouse_height, elements)
VALUES ('Depósito Principal', 30, 40, '[]')
ON CONFLICT DO NOTHING;
