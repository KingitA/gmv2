"use server"

import { GoogleGenerativeAI } from "@google/generative-ai"
import { createAdminClient } from "@/lib/supabase/admin"

// Initialize Google Generative AI with the API key
// Prioritize GOOGLE_API_KEY if exists, otherwise fallback to others or empty
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || ""
const genAI = new GoogleGenerativeAI(apiKey)
// Use the 'models/gemini-embedding-001' model (768 dimensions) for compatibility
const model = genAI.getGenerativeModel({ model: "models/gemini-embedding-001" })

export async function generateEmbedding(text: string): Promise<number[]> {
    if (!apiKey) {
        throw new Error("Missing GOOGLE_API_KEY or GEMINI_API_KEY environment variable.")
    }

    // Pre-process text to remove newlines and extra spaces
    const cleanedText = text.replace(/\n/g, " ").trim()

    try {
        console.log("Generating embedding using model:", (model as any).model || "unknown");
        const result = await model.embedContent({
            content: { parts: [{ text: cleanedText }], role: "user" },
            outputDimensionality: 768,
        } as any)
        const embedding = result.embedding
        return embedding.values
    } catch (error) {
        console.error("Error generating embedding with Gemini:", error)
        throw error
    }
}

export async function updateProductEmbedding(productId: string) {
    const supabase = createAdminClient()

    // 1. Get product details + aliases
    const [{ data: product, error: fetchError }, { data: aliases }] = await Promise.all([
        supabase
            .from("articulos")
            .select("descripcion, sku, ean13, categoria, proveedor:proveedor_id(nombre)")
            .eq("id", productId)
            .single(),
        supabase
            .from("articulos_alias")
            .select("descripcion_proveedor, codigo_proveedor, alias_texto")
            .eq("articulo_id", productId),
    ])

    if (fetchError || !product) {
        console.error("Error fetching product for embedding:", fetchError)
        throw new Error(`Product ${productId} not found`)
    }

    // 2. Construct text representation
    const p: any = product
    const proveedorNombre = Array.isArray(p.proveedor) ? p.proveedor[0]?.nombre : p.proveedor?.nombre

    const aliasLines = (aliases || []).map((a: any) => [
        a.descripcion_proveedor,
        a.codigo_proveedor,
        a.alias_texto,
    ].filter(Boolean).join(' ')).filter(Boolean).join(' | ')

    const textToEmbed = `
        Producto: ${p.descripcion}
        Descripción: ${p.descripcion}
        SKU: ${p.sku}
        Proveedor: ${proveedorNombre || ''}
        Categoría: ${p.categoria || ''} - ${p.subcategoria || ''} - ${p.rubro || ''}
        ${aliasLines ? `Aliases: ${aliasLines}` : ''}
    `.trim()

    // 3. Generate embedding
    try {
        const embedding = await generateEmbedding(textToEmbed)

        // 4. Save to database
        // Ensure the database 'embedding' column is vector(768)
        const { error: updateError } = await supabase
            .from("articulos")
            .update({ embedding })
            .eq("id", productId)

        if (updateError) {
            console.error("Error saving embedding:", updateError)
            throw updateError
        }

        return { success: true, productId }

    } catch (err) {
        console.error("Error generating/saving embedding:", err)
        throw err
    }
}

export async function searchProductsByVector(query: string, matchThreshold = 0.35, matchCount = 20) {
    if (!apiKey) {
        console.warn("API Key missing, skipping vector search")
        return []
    }

    try {
        const embedding = await generateEmbedding(query)
        const supabase = createAdminClient()

        // Call RPC — function name is match_articulos (768 dimensions, Gemini embeddings)
        const { data: products, error } = await supabase.rpc("match_articulos", {
            query_embedding: embedding,
            match_threshold: matchThreshold,
            match_count: matchCount,
        })

        if (error) {
            console.error("Vector search RPC error:", error)
            return []
        }

        return products || []
    } catch (err) {
        console.error("Vector search exception:", err)
        return []
    }
}

// ─── PROVEEDORES ─────────────────────────────────────────────────────────────

export async function updateProveedorEmbedding(proveedorId: string) {
    const supabase = createAdminClient()

    const { data: proveedor, error: fetchError } = await supabase
        .from("proveedores")
        .select("nombre, cuit, direccion")
        .eq("id", proveedorId)
        .single()

    if (fetchError || !proveedor) {
        throw new Error(`Proveedor ${proveedorId} not found`)
    }

    const textToEmbed = `
        Proveedor: ${proveedor.nombre}
        Nombre: ${proveedor.nombre}
        CUIT: ${proveedor.cuit || ''}
        Dirección: ${proveedor.direccion || ''}
    `.trim()

    const embedding = await generateEmbedding(textToEmbed)

    const { error: updateError } = await supabase
        .from("proveedores")
        .update({ embedding })
        .eq("id", proveedorId)

    if (updateError) throw updateError

    return { success: true, proveedorId }
}

export async function searchProveedoresByVector(query: string, matchThreshold = 0.35, matchCount = 10) {
    if (!apiKey) return []

    try {
        const embedding = await generateEmbedding(query)
        const supabase = createAdminClient()

        const { data, error } = await supabase.rpc("match_proveedores", {
            query_embedding: embedding,
            match_threshold: matchThreshold,
            match_count: matchCount,
        })

        if (error) {
            console.error("Vector search proveedores RPC error:", error)
            return []
        }

        return data || []
    } catch (err) {
        console.error("Vector search proveedores exception:", err)
        return []
    }
}

// ─── CLIENTES ─────────────────────────────────────────────────────────────────

export async function updateClienteEmbedding(clienteId: string) {
    const supabase = createAdminClient()

    const { data: cliente, error: fetchError } = await supabase
        .from("clientes")
        .select("nombre, razon_social, cuit, direccion, localidad, provincia, tipo_canal")
        .eq("id", clienteId)
        .single()

    if (fetchError || !cliente) {
        throw new Error(`Cliente ${clienteId} not found`)
    }

    const textToEmbed = `
        Cliente: ${cliente.nombre}
        Nombre: ${cliente.nombre}
        Razón social: ${cliente.razon_social || ''}
        CUIT: ${cliente.cuit || ''}
        Dirección: ${cliente.direccion || ''}
        Localidad: ${cliente.localidad || ''} ${cliente.provincia || ''}
        Canal: ${cliente.tipo_canal || ''}
    `.trim()

    const embedding = await generateEmbedding(textToEmbed)

    const { error: updateError } = await supabase
        .from("clientes")
        .update({ embedding })
        .eq("id", clienteId)

    if (updateError) throw updateError

    return { success: true, clienteId }
}

export async function searchClientesByVector(query: string, matchThreshold = 0.35, matchCount = 10) {
    if (!apiKey) return []

    try {
        const embedding = await generateEmbedding(query)
        const supabase = createAdminClient()

        const { data, error } = await supabase.rpc("match_clientes", {
            query_embedding: embedding,
            match_threshold: matchThreshold,
            match_count: matchCount,
        })

        if (error) {
            console.error("Vector search clientes RPC error:", error)
            return []
        }

        return data || []
    } catch (err) {
        console.error("Vector search clientes exception:", err)
        return []
    }
}
