// =====================================================
// AI Brain — Type Definitions
// =====================================================

export type MessageClassification =
  | 'pedido'
  | 'orden_compra'
  | 'factura_proveedor'
  | 'pago'
  | 'cambio_precio'
  | 'reclamo'
  | 'consulta'
  | 'spam'
  | 'otro'

export type EntityType = 'cliente' | 'proveedor' | 'desconocido'

export type EventType =
  | 'vencimiento_proveedor'
  | 'pedido_preparar'
  | 'mercaderia_recibir'
  | 'cambio_precio'
  | 'pago_imputar'
  | 'reclamo_resolver'
  | 'tarea_general'
  | 'recordatorio'
  | 'pedido_link_drive'

export type EventPriority = 'baja' | 'media' | 'alta' | 'urgente'
export type EventStatus = 'pendiente' | 'en_progreso' | 'completada' | 'cancelada'

export interface ClassificationResult {
  classification: MessageClassification
  entityType: EntityType
  entityName: string | null
  confidence: number
  summary: string
  suggestedEvent?: {
    title: string
    description: string
    eventType: EventType
    priority: EventPriority
    dueDate?: string
  }
  extractedData: {
    products?: Array<{ name: string; quantity?: number; price?: number }>
    amount?: number
    currency?: string
    date?: string
    referenceNumber?: string
    [key: string]: unknown
  }
}

// ── Enriched Classification (Unified Brain) ────────────
// Returned by the unified classifier that sees email text + attachment content

export interface ExtractedInvoiceData {
  tipo_comprobante: string | null
  numero_comprobante: string | null
  fecha_comprobante: string | null
  fecha_vencimiento: string | null
  cuit_emisor: string | null
  razon_social_emisor: string | null
  total: number | null
  subtotal_neto: number | null
  iva: number | null
  percepciones: number | null
  concepto: 'producto' | 'servicio' | 'transporte' | 'mixto' | null
}

export interface ExtractedPaymentData {
  monto: number | null
  fecha_pago: string | null
  medio_pago: string | null  // transferencia, efectivo, cheque, echeq, deposito, etc.
  numero_referencia: string | null
  banco: string | null
  cbu_origen: string | null
  pagador_nombre: string | null
  pagador_tipo: 'cliente' | 'proveedor' | 'desconocido'
  // Cheque/echeq fields
  tipo_cheque?: string | null  // 'echeq' | 'cheque fisico'
  numero_cheque?: string | null
  fecha_emision?: string | null
  plaza?: string | null  // localidad del cheque
}

export interface ExtractedPriceListData {
  proveedor_nombre: string | null
  fecha_vigencia: string | null
  porcentaje_aumento: number | null
  porcentaje_descuento: number | null
  productos_mencionados: number   // count of products mentioned
  es_lista_completa: boolean      // full list vs. partial update
}

export interface ExtractedReclamoData {
  motivo: string | null
  productos_afectados: Array<{ nombre: string; cantidad?: number; problema?: string }>
  urgencia: 'baja' | 'media' | 'alta' | 'urgente'
  accion_solicitada: string | null  // reposición, nota de crédito, devolución
}

// ── XLSX Deep Analysis Types (Claude) ──────────────────

export interface XlsxOrderItem {
  description: string
  quantity: number
  code?: string
  brand?: string
  color?: string
}

export interface XlsxOrderAnalysis {
  customer: string | null
  items: XlsxOrderItem[]
}

export interface XlsxPriceListItem {
  description: string
  code?: string
  brand?: string
  price: number | null
  previous_price?: number | null
  unit?: string           // unidad, bulto, caja, etc.
  is_offer?: boolean
  offer_valid_until?: string | null  // YYYY-MM-DD
}

export interface XlsxPriceListAnalysis {
  proveedor_nombre: string | null
  fecha_vigencia: string | null
  es_lista_completa: boolean
  es_oferta: boolean
  items: XlsxPriceListItem[]
}

export interface XlsxInvoiceLineItem {
  description: string
  quantity: number
  unit_price: number
  subtotal: number
  code?: string
}

export interface XlsxInvoiceAnalysis {
  tipo_comprobante: string | null
  numero_comprobante: string | null
  fecha_comprobante: string | null
  fecha_vencimiento: string | null
  cuit_emisor: string | null
  razon_social_emisor: string | null
  total: number | null
  subtotal_neto: number | null
  iva: number | null
  percepciones: number | null
  concepto: 'producto' | 'servicio' | 'transporte' | 'mixto' | null
  items: XlsxInvoiceLineItem[]
}

export interface EnrichedClassificationResult extends ClassificationResult {
  // Typed extraction data — only the relevant one is populated
  invoiceData?: ExtractedInvoiceData
  paymentData?: ExtractedPaymentData
  priceListData?: ExtractedPriceListData
  reclamoData?: ExtractedReclamoData
  // Attachment analysis
  attachmentsSummary?: string  // Brief description of what was found in attachments
  hasAttachmentContent: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AiConversation {
  id: string
  title: string | null
  source: 'chat' | 'gmail' | 'whatsapp'
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

export interface AiMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface AiEmail {
  id: string
  gmail_id: string
  thread_id: string | null
  from_email: string | null
  from_name: string | null
  to_email: string | null
  subject: string | null
  body_text: string | null
  body_html: string | null
  received_at: string | null
  is_read: boolean
  is_processed: boolean
  labels: string[]
  classification: MessageClassification | null
  entity_type: EntityType | null
  entity_name: string | null
  confidence: number | null
  ai_summary: string | null
  created_at: string
  updated_at: string
}

export interface AiAgendaEvent {
  id: string
  title: string
  description: string | null
  event_type: EventType
  priority: EventPriority
  status: EventStatus
  due_date: string | null
  due_time: string | null
  source: 'gmail' | 'whatsapp' | 'chat' | 'sistema' | null
  source_ref_id: string | null
  related_entity_type: string | null
  related_entity_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface GmailSyncResult {
  totalFetched: number
  newEmails: number
  classified: number
  eventsCreated: number
  errors: string[]
  ordersProcessed?: number
  ordersAutoCreated?: number
  ordersSentToReview?: number
}
