export type UnidadFactura = "UNIDAD" | "BULTO" | "CAJA" | "PACK" | "DOCENA";

export interface ConversionResult {
    factor: number;
    source: string;
    requiresReview: boolean;
    warningType?: string;
    warningMessage?: string;
}

// Helper to normalize text for consistent matching - Reused from matching or duplicated if simple
const normalizeText = (text: string | null | undefined): string => {
    if (!text) return "";
    return text
        .toLowerCase()
        .trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[\/\.\-\,]/g, " ")
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ");
};

/**
 * Resolves the conversion factor to normalize OCR quantities to base unit (UNIDAD)
 */
export function resolveFactorConversion(params: {
    proveedorDefaultUnidad?: UnidadFactura | null;
    articuloUnidadesPorBulto?: number | null;
    apUnidadFactura?: UnidadFactura | null;
    apFactorConversion?: number | null;
    descripcionOcr?: string;
    ocrUnidadMedida?: string | null;
    precioDocumento?: number | null;
    costoBaseArticulo?: number | null;
}): ConversionResult {
    const {
        proveedorDefaultUnidad,
        articuloUnidadesPorBulto,
        apUnidadFactura,
        apFactorConversion,
        descripcionOcr = "",
        ocrUnidadMedida = "",
        precioDocumento = 0,
        costoBaseArticulo = 0
    } = params;

    // (1) HIGHEST PRIORITY: Explicit manual factor_conversion override
    if (apFactorConversion && apFactorConversion > 0) {
        return {
            factor: apFactorConversion,
            source: "ARTICULO_PROVEEDOR_FACTOR",
            requiresReview: false
        };
    }

    // (2) PRIORITY 1: Explicit Document Labels (Unit of Measure)
    if (ocrUnidadMedida || descripcionOcr) {
        const textToAnalyze = normalizeText(`${ocrUnidadMedida || ''} ${descripcionOcr || ''}`);

        const unitMarkers = ["unidad", "unidades", "uni", "u", "un"];
        const hasUnitMarker = unitMarkers.some(m =>
            textToAnalyze === m ||
            textToAnalyze.split(' ').includes(m) ||
            (m.length > 2 && textToAnalyze.includes(m))
        );

        if (hasUnitMarker) {
            return {
                factor: 1,
                source: "OCR_LABEL_UNIDAD",
                requiresReview: false
            };
        }

        const bultoMarkers = [
            "bulto", "bultos", "caja", "cajas", "pack", "packs",
            "paquete", "paquetes", "bto", "btos", "cja", "cjas", "pk"
        ];
        const hasBultoMarker = bultoMarkers.some(m =>
            textToAnalyze.split(' ').includes(m) ||
            (m.length >= 3 && textToAnalyze.includes(m))
        );

        if (hasBultoMarker && articuloUnidadesPorBulto && articuloUnidadesPorBulto > 0) {
            return {
                factor: articuloUnidadesPorBulto,
                source: "OCR_LABEL_BULTO",
                requiresReview: false
            };
        }
    }

    // (3) PRIORITY 2: Price-based Coherence (Smart Heuristic)
    if (precioDocumento && precioDocumento > 0 && costoBaseArticulo && costoBaseArticulo > 0 && articuloUnidadesPorBulto && articuloUnidadesPorBulto > 1) {
        const costPerUnit = costoBaseArticulo;
        const costPerPack = costoBaseArticulo * articuloUnidadesPorBulto;

        const diffUnit = Math.abs(precioDocumento / costPerUnit - 1);
        const diffPack = Math.abs(precioDocumento / costPerPack - 1);

        if (diffPack < 0.20 && diffPack < diffUnit) {
            return {
                factor: articuloUnidadesPorBulto,
                source: "HEURISTICA_PRECIO_BULTO",
                requiresReview: false
            };
        } else if (diffUnit < 0.20) {
            return {
                factor: 1,
                source: "HEURISTICA_PRECIO_UNIDAD",
                requiresReview: false
            };
        }
    }

    // (4) FALLBACK
    const unidad = apUnidadFactura || proveedorDefaultUnidad || "UNIDAD";

    if (unidad === "UNIDAD") {
        return {
            factor: 1,
            source: apUnidadFactura ? "ARTICULO_PROVEEDOR_UNIDAD" : "PROVEEDOR_DEFAULT_UNIDAD",
            requiresReview: false
        };
    }

    if (articuloUnidadesPorBulto && articuloUnidadesPorBulto > 0) {
        return {
            factor: articuloUnidadesPorBulto,
            source: apUnidadFactura ? "ARTICULO_PROVEEDOR_UNIDAD" : "PROVEEDOR_DEFAULT_UNIDAD",
            requiresReview: false
        };
    }

    if (unidad === "DOCENA") {
        return {
            factor: 12,
            source: "DOCENA_FALLBACK",
            requiresReview: true,
            warningType: "DOCENA_SIN_CONFIG",
            warningMessage: "Se asumió factor=12 para DOCENA sin configuración"
        };
    }

    return {
        factor: 1,
        source: "SIN_CONFIG",
        requiresReview: true,
        warningType: "UNIDAD_SIN_FACTOR",
        warningMessage: `No se pudo determinar el factor para ${unidad}. Se asumió factor=1.`
    };
}
