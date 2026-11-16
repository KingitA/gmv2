/**
 * Número y clase de un comprobante de compra, en forma comparable (E-36).
 * Archivo PURO (sin imports): tests en mobile/packages/core/test/entrada-comprobantes.test.ts
 */

/** Números inventados por el sistema cuando no se pudo leer el real. */
export function esNumeroProvisorio(numero: unknown): boolean {
    return /^(PENDIENTE|GMAIL|GMAIL-ADD)-/i.test(String(numero || '').trim());
}

/**
 * Número de comprobante en forma comparable: "A 0001-00000123", "0001 - 123",
 * "1-123" y "000100000123" son la misma factura ⇒ "1-123". Vacío si no hay número
 * real (o es uno provisorio).
 */
export function normalizarNumeroComprobante(numero: unknown): string {
    const s = String(numero || '').trim();
    if (!s || esNumeroProvisorio(s)) return '';
    const grupos: string[] = Array.from(s.match(/\d+/g) || []);
    const sinCeros = (d: string) => d.replace(/^0+/, '') || '0';
    const [primero = '', segundo = ''] = grupos;
    if (grupos.length >= 2) return `${sinCeros(primero)}-${sinCeros(segundo)}`;
    if (grupos.length === 1) {
        const d = primero;
        // Punto de venta y número pegados (12 o 13 dígitos): los últimos 8 son el número
        if (d.length > 8) return `${sinCeros(d.slice(0, -8))}-${sinCeros(d.slice(-8))}`;
        return `-${sinCeros(d)}`;
    }
    return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Clase del comprobante para detectar duplicados. Cada clase tiene su propia numeración
 * (la factura 1-123 y la nota de crédito 1-123 son dos documentos distintos), pero una
 * misma factura puede haberse leído como FA una vez y como Adquisición otra.
 */
export function claseComprobante(tipo: unknown): 'factura' | 'credito' | 'debito' | 'remito' {
    const t = String(tipo || '');
    if (['NC', 'NCA', 'NCB', 'NCC', 'Reversa'].includes(t)) return 'credito';
    if (['ND', 'NDA', 'NDB', 'NDC'].includes(t)) return 'debito';
    if (t === 'Remito') return 'remito';
    return 'factura';
}
