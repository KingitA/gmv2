
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspect() {
    console.log("Checking Carefree products...");
    const { data, error } = await supabase
        .from('articulos')
        .select(`
            id, descripcion, precio_compra, sku,
            proveedores!inner(nombre)
        `)
        .ilike('descripcion', '%carefree%')
        .limit(10);

    if (error) {
        console.error("Error:", error);
    } else {
        console.table(data.map(p => ({
            ID: p.id,
            Desc: p.descripcion,
            Precio: p.precio_compra,
            Proveedor: p.proveedores?.nombre
        })));
    }

    console.log("\nChecking products where Provider name is Carefree but description isn't...");
    const { data: data2, error: error2 } = await supabase
        .from('articulos')
        .select(`
            id, descripcion, precio_compra,
            proveedores!inner(nombre)
        `)
        .ilike('proveedores.nombre', '%carefree%')
        .not('descripcion', 'ilike', '%carefree%')
        .limit(10);

    if (error2) {
        console.error("Error 2:", error2);
    } else {
        console.table(data2.map(p => ({
            ID: p.id,
            Desc: p.descripcion,
            Precio: p.precio_compra,
            Proveedor: p.proveedores?.nombre
        })));
    }
}

inspect();
