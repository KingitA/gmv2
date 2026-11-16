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
 * Tipos con los que un comprobante puede ser "el mismo documento" si coincide el número.
 * Cada tipo tiene su propia numeración: la factura A 1-123, la factura B 1-123 y la nota de
 * crédito 1-123 son tres documentos distintos (la LETRA es parte del tipo). Lo único que se
 * cruza es lo que la lectura no puede distinguir:
 *   · una factura leída sin datos fiscales queda como 'Adquisicion' ⇒ puede ser la FA/FB/FC;
 *   · 'NC' / 'ND' sin letra ⇒ puede ser la NCA/NCB/NCC (o NDA/NDB/NDC).
 */
export function tiposCompatibles(tipo: unknown): string[] {
    const t = String(tipo || '');
    if (['FA', 'FB', 'FC'].includes(t)) return [t, 'Adquisicion'];
    if (t === 'Adquisicion') return ['Adquisicion', 'FA', 'FB', 'FC'];
    if (['NCA', 'NCB', 'NCC'].includes(t)) return [t, 'NC'];
    if (t === 'NC') return ['NC', 'NCA', 'NCB', 'NCC'];
    if (['NDA', 'NDB', 'NDC'].includes(t)) return [t, 'ND'];
    if (t === 'ND') return ['ND', 'NDA', 'NDB', 'NDC'];
    return t ? [t] : [];
}
