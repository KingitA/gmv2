// =====================================================
// AI Brain — Claude AI Engine
// =====================================================

import Anthropic from '@anthropic-ai/sdk'
import { MODELO_CLAUDE, ESFUERZO_SIMPLE, TOPE_RESPUESTA_CORTA } from './modelos-claude'
import {
    SYSTEM_PROMPT_CLASSIFIER,
    SYSTEM_PROMPT_CHAT,
    SYSTEM_PROMPT_EMAIL_SUMMARY,
    SYSTEM_PROMPT_UNIFIED_CLASSIFIER,
} from './prompts'
import type {
    ClassificationResult,
    EnrichedClassificationResult,
    ChatMessage,
} from './types'
import { registrarFallaIA } from './fallas-ia'

// Singleton client
let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
    if (!anthropicClient) {
        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) {
            throw new Error(
                'ANTHROPIC_API_KEY no está configurada. Agregala a .env.local'
            )
        }
        anthropicClient = new Anthropic({ apiKey })
    }
    return anthropicClient
}

// El modelo se nombra en un solo lugar: lib/ai/modelos-claude.ts (E-82)
const MODEL = MODELO_CLAUDE.extraccion

/**
 * Llama a Claude y, si falla por saldo o cuota (402 / 429 / "credit balance"), lo anota en
 * ia_fallas y deja el aviso en la bandeja de Jarvis (E-101). El error se relanza igual: quien
 * llama decide qué hacer. registrarFallaIA no lanza nunca.
 */
async function conAvisoDeFalla<T>(origen: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn()
    } catch (e) {
        await registrarFallaIA('claude', e, origen)
        throw e
    }
}

/**
 * Clasifica un mensaje (email, chat, WhatsApp) determinando su tipo,
 * entidad relacionada, y datos extraídos.
 */
export async function classifyMessage(
    content: string,
    metadata?: {
        from?: string;
        to?: string;
        subject?: string;
        attachments?: Array<{ filename: string; mimeType: string; size: number }>;
    }
): Promise<ClassificationResult> {
    const client = getClient()

    let userContent = content
    if (metadata) {
        const parts: string[] = []
        parts.push(`De: ${metadata.from || 'desconocido'}`)
        if (metadata.to) parts.push(`Para: ${metadata.to}`)
        parts.push(`Asunto: ${metadata.subject || 'sin asunto'}`)
        if (metadata.attachments && metadata.attachments.length > 0) {
            const attList = metadata.attachments
                .map(a => `  - ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)}KB)`)
                .join('\n')
            parts.push(`Archivos adjuntos (${metadata.attachments.length}):\n${attList}`)
        } else {
            parts.push('Archivos adjuntos: ninguno')
        }
        parts.push('', 'Contenido del email:', content)
        userContent = parts.join('\n')
    }

    const response = await conAvisoDeFalla('clasificar un mensaje', () => client.messages.create({
        model: MODEL,
        max_tokens: TOPE_RESPUESTA_CORTA, // el modelo piensa antes de contestar y eso cuenta en el tope
        output_config: { effort: ESFUERZO_SIMPLE },
        system: SYSTEM_PROMPT_CLASSIFIER,
        messages: [
            {
                role: 'user',
                content: userContent,
            },
        ],
    }))

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Claude no devolvió una respuesta de texto')
    }

    try {
        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = textBlock.text.trim()
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (jsonMatch) {
            jsonStr = jsonMatch[1].trim()
        }
        return JSON.parse(jsonStr) as ClassificationResult
    } catch {
        console.error('Error parsing Claude classification response:', textBlock.text)
        return {
            classification: 'otro',
            entityType: 'desconocido',
            entityName: null,
            confidence: 0,
            summary: 'No se pudo clasificar el mensaje',
            extractedData: {},
        }
    }
}

/**
 * Unified Brain — Classifies AND extracts structured data in a single pass.
 * Receives the email text + content extracted from attachments (by Gemini OCR).
 * Returns enriched classification with typed data per classification type.
 */
export async function classifyAndExtract(
    content: string,
    attachmentContent: string,
    metadata?: {
        from?: string;
        to?: string;
        subject?: string;
        attachments?: Array<{ filename: string; mimeType: string; size: number }>;
    }
): Promise<EnrichedClassificationResult> {
    const client = getClient()

    // Build rich context for Claude
    const parts: string[] = []
    if (metadata) {
        parts.push(`De: ${metadata.from || 'desconocido'}`)
        if (metadata.to) parts.push(`Para: ${metadata.to}`)
        parts.push(`Asunto: ${metadata.subject || 'sin asunto'}`)
        if (metadata.attachments && metadata.attachments.length > 0) {
            const attList = metadata.attachments
                .map(a => `  - ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)}KB)`)
                .join('\n')
            parts.push(`Archivos adjuntos (${metadata.attachments.length}):\n${attList}`)
        } else {
            parts.push('Archivos adjuntos: ninguno')
        }
    }

    parts.push('', '══════ CONTENIDO DEL EMAIL ══════', content)

    if (attachmentContent.trim()) {
        parts.push('', '══════ CONTENIDO EXTRAÍDO DE ADJUNTOS ══════', attachmentContent)
    }

    const userContent = parts.join('\n')

    // Truncate if too long (Claude context limit)
    const maxLen = 100000
    const truncatedContent = userContent.length > maxLen
        ? userContent.substring(0, maxLen) + '\n\n[... contenido truncado por exceder límite]'
        : userContent

    const response = await conAvisoDeFalla('clasificar un mail', () => client.messages.create({
        model: MODEL,
        max_tokens: 16000, // antes 4096: ahora el pensamiento cuenta en el tope y el JSON de un mail largo no puede cortarse
        output_config: { effort: ESFUERZO_SIMPLE },
        system: SYSTEM_PROMPT_UNIFIED_CLASSIFIER,
        messages: [
            {
                role: 'user',
                content: truncatedContent,
            },
        ],
    }))

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Claude no devolvió una respuesta de texto')
    }

    try {
        let jsonStr = textBlock.text.trim()
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (jsonMatch) {
            jsonStr = jsonMatch[1].trim()
        }
        // Also try to extract JSON object directly
        const objMatch = jsonStr.match(/\{[\s\S]*\}/)
        if (objMatch) {
            jsonStr = objMatch[0]
        }
        const parsed = JSON.parse(jsonStr) as EnrichedClassificationResult
        parsed.hasAttachmentContent = !!attachmentContent.trim()
        return parsed
    } catch {
        console.error(`Error parsing Claude unified classification response (stop_reason: ${response.stop_reason}):`, textBlock.text.substring(0, 500))
        return {
            classification: 'otro',
            entityType: 'desconocido',
            entityName: null,
            confidence: 0,
            // que quede el motivo: no es lo mismo "no es nada" que "la lectura se cortó"
            summary: response.stop_reason === 'max_tokens'
                ? 'No se pudo clasificar el mensaje: la respuesta de la IA se cortó (mail o adjuntos demasiado largos). Revisarlo a mano.'
                : 'No se pudo clasificar el mensaje: la respuesta de la IA no se pudo leer. Revisarlo a mano.',
            extractedData: {},
            hasAttachmentContent: !!attachmentContent.trim(),
        }
    }
}

/**
 * Chat conversacional con contexto del ERP.
 * Recibe historial de mensajes y contexto adicional de la DB.
 */
export async function chat(
    messages: ChatMessage[],
    dbContext?: string
): Promise<string> {
    const client = getClient()

    let systemPrompt = SYSTEM_PROMPT_CHAT
    if (dbContext) {
        systemPrompt += `\n\nCONTEXTO ACTUAL DEL SISTEMA:\n${dbContext}`
    }

    const anthropicMessages = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }))

    const response = await conAvisoDeFalla('chat', () => client.messages.create({
        model: MODEL,
        max_tokens: 8000, // antes 2048: deja lugar para pensar
        output_config: { effort: ESFUERZO_SIMPLE },
        system: systemPrompt,
        messages: anthropicMessages,
    }))

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
        return 'No pude generar una respuesta. Intentá de nuevo.'
    }

    return textBlock.text
}

/**
 * Genera un resumen corto de un email.
 */
export async function summarizeEmail(
    emailContent: string,
    subject?: string,
    from?: string
): Promise<string> {
    const client = getClient()

    const userContent = [
        from && `De: ${from}`,
        subject && `Asunto: ${subject}`,
        '',
        emailContent,
    ]
        .filter(Boolean)
        .join('\n')

    const response = await conAvisoDeFalla('resumir un mail', () => client.messages.create({
        model: MODEL,
        max_tokens: TOPE_RESPUESTA_CORTA, // antes 256: con ese tope el modelo nuevo puede gastarlo pensando y no escribir el resumen
        output_config: { effort: ESFUERZO_SIMPLE },
        system: SYSTEM_PROMPT_EMAIL_SUMMARY,
        messages: [
            {
                role: 'user',
                content: userContent,
            },
        ],
    }))

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
        return 'No se pudo resumir el email'
    }

    return textBlock.text
}
