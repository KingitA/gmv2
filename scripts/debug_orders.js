
const { createClient } = require('@supabase/supabase-js');

// Hardcoded keys for debugging session
const supabaseUrl = 'https://ugkttgqgyhvkprpdmqql.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVna3R0Z3FneWh2a3BycGRtcXFsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTMyOTk5NSwiZXhwIjoyMDc2OTA1OTk1fQ.bOWi9tBEGNiE27hEDwqF1h-EuQ_EHYCzSfpms60o_4U';

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
});

async function checkOrders() {
    console.log('Fetching orders...');
    const { data, error } = await supabase
        .from('ordenes_compra')
        .select(`
      id, 
      numero_orden, 
      estado, 
      proveedor_id, 
      created_at, 
      fecha_orden
    `)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error fetching orders:', error);
        return;
    }

    console.log('Last 5 orders in DB:');
    console.table(data);
}

checkOrders();
