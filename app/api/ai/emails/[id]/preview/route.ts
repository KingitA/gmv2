import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const supabase = createAdminClient()

    // 1. Get email data
    const { data: email, error } = await supabase
        .from('ai_emails')
        .select('id, subject, from_email, from_name, to_email, body_html, body_text, received_at, classification, ai_summary')
        .eq('id', id)
        .single()

    if (error || !email) {
        return NextResponse.json({ error: 'Email no encontrado' }, { status: 404 })
    }

    // 2. Get attachments with signed URLs
    const { data: attachments } = await supabase
        .from('ai_email_attachments')
        .select('id, filename, mime_type, size_bytes, storage_path')
        .eq('email_id', id)

    const attachmentsWithUrls = []
    for (const att of (attachments || [])) {
        let url: string | null = null
        if (att.storage_path) {
            const { data: signedData } = await supabase.storage
                .from('attachments')
                .createSignedUrl(att.storage_path, 3600) // 1 hour expiry
            url = signedData?.signedUrl || null
        }
        attachmentsWithUrls.push({
            id: att.id,
            filename: att.filename,
            mimeType: att.mime_type,
            sizeBytes: att.size_bytes,
            url,
        })
    }

    return NextResponse.json({
        email: {
            id: email.id,
            subject: email.subject,
            from: email.from_name || email.from_email,
            fromEmail: email.from_email,
            to: email.to_email,
            bodyHtml: email.body_html,
            bodyText: email.body_text,
            receivedAt: email.received_at,
            classification: email.classification,
            summary: email.ai_summary,
        },
        attachments: attachmentsWithUrls,
    })
}
