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
        const result = await model.embedContent(cleanedText)
        const embedding = result.embedding
        return embedding.values
    } catch (error) {
        console.error("Error generating embedding with Gemini:", error)
        throw error
    }
}

export async function updateProductEmbedding(productId: string) {
    const supabase = createAdminClient()

    // 1. Get product details
    const { data: product, error: fetchError } = await supabase
        .from("articulos")
        .select("descripcion, sku, ean13, categoria, proveedor:proveedor_id(nombre)")
        .eq("id", productId)
        .single()

    if (fetchError || !product) {
        console.error("Error fetching product for embedding:", fetchError)
        throw new Error(`Product ${productId} not found`)
    }

    // 2. Construct text representation
    const p: any = product
    // Handle array response from joins if any
    const proveedorNombre = Array.isArray(p.proveedor) ? p.proveedor[0]?.nombre : p.proveedor?.nombre
    // Category is a simple field in articulos table, not a join
    const categoriaNombre = p.categoria

    const textToEmbed = `
        Producto: ${p.descripcion}
        Descripción: ${p.descripcion}
        SKU: ${p.sku}
        Proveedor: ${p.proveedor?.nombre || ''}
        Categoría: ${p.categoria || ''} - ${p.subcategoria || ''} - ${p.rubro || ''}
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
