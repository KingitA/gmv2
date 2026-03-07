
import { createClient } from "./lib/supabase/server"

async function debugIds() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        console.log("No user found")
        return
    }

    console.log("Current Auth User:", { id: user.id, email: user.email })

    // Check Vendors
    const { data: vendorByAuthId } = await supabase.from("vendedores").select("id, nombre").eq("id", user.id).maybeSingle()
    console.log("Found in 'vendedores' by AUTH ID:", vendorByAuthId || "NO")

    const { data: vendorByEmail } = await supabase.from("vendedores").select("id, nombre").eq("email", user.email).maybeSingle()
    console.log("Found in 'vendedores' by EMAIL:", vendorByEmail || "NO")

    // Check CRM
    const { data: crmUser } = await supabase.from("usuarios_crm").select("id, email, viajante_id").eq("email", user.email).maybeSingle()
    console.log("Found in 'usuarios_crm':", crmUser || "NO")

    if (crmUser && crmUser.id) {
        const { data: vendorByCrmId } = await supabase.from("vendedores").select("id, nombre").eq("id", crmUser.id).maybeSingle()
        console.log("Found in 'vendedores' by CRM ID:", vendorByCrmId || "NO")
    }
}

debugIds()
