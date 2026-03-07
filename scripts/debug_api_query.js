
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ugkttgqgyhvkprpdmqql.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVna3R0Z3FneWh2a3BycGRtcXFsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTMyOTk5NSwiZXhwIjoyMDc2OTA1OTk1fQ.bOWi9tBEGNiE27hEDwqF1h-EuQ_EHYCzSfpms60o_4U';

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
});

async function checkApiQuery() {
    console.log('Running API query simulation...');

    const { data: ordenes, error } = await supabase
        .from("ordenes_compra")
        .select(`
      id,
      numero_orden,
      fecha_orden,
      estado,
      observaciones,
      proveedor:proveedores (
        id,
        razon_social,
        cuit
      ),
      items:ordenes_compra_detalle (
        count
      )
    `)
        .in("estado", ["pendiente", "recibida_parcial"])
        .order("fecha_orden", { ascending: false });

    if (error) {
        console.error('Error fetching orders:', error);
        return;
    }

    console.log(`Found ${ordenes.length} orders.`);

    if (ordenes.length > 0) {
        console.log('First order sample:');
        console.dir(ordenes[0], { depth: null });
    } else {
        console.log('No orders found with status "pendiente" or "recibida_parcial"');
    }
}

checkApiQuery();
