const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** UUID bien formado (los ids que generan los dispositivos son v4). */
export const esUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v)
