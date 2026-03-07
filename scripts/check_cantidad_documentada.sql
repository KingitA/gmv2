-- Verificar cantidad documentada para ESCOBILLON GOLF
SELECT 
    ri.id,
    a.descripcion,
    ri.cantidad_oc,
    ri.cantidad_documentada,
    ri.cantidad_fisica,
    r.numero_recepcion,
    r.created_at
FROM recepciones_items ri
JOIN articulos a ON a.id = ri.articulo_id
JOIN recepciones r ON r.id = ri.recepcion_id
WHERE a.descripcion ILIKE '%golf%'
ORDER BY r.created_at DESC
LIMIT 5;

-- Ver documentos OCR procesados para esta recepción
SELECT 
    rd.tipo_documento,
    rd.datos_ocr->'items' as items,
    rd.created_at
FROM recepciones_documentos rd
JOIN recepciones r ON r.id = rd.recepcion_id
WHERE r.numero_recepcion = 'TU_NUMERO_DE_RECEPCION_AQUI'
ORDER BY rd.created_at;
