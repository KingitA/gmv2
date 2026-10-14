# Jarvis: bitácora de trabajo

Acá se anota **todo lo que se va haciendo**, para retomar desde cualquier computadora o sesión.
El plan está en [PLAN.md](PLAN.md). Lo más nuevo va arriba.

**Rama:** `playroom-cerebro` (en GitHub). **No está en main.** Pasa a main solo con el OK de Juan.

---

## Cómo retomar (para Juan o para otra sesión de Claude)
1. Abrir la rama `playroom-cerebro` (o pedirle a Claude: "seguí con Jarvis, leé docs/playroom-cerebro/BITACORA.md").
2. Leer **"Estado actual"** y **"Pendientes"** acá abajo.
3. Las migraciones de base (archivos `supabase/migrations/2026…_jarvis_*.sql`) **las aplica Juan a mano** en Supabase → SQL Editor. En "Migraciones" dice cuáles faltan.

## Estado actual
- **Etapa 0 (cimientos): código listo, falta aplicar la migración.**
- Etapa 1 (chat nuevo): en curso.

## Migraciones
| Archivo | Qué hace | ¿Aplicada? |
|---|---|---|
| `20261014_jarvis_cimientos.sql` | Bitácora inborrable (`ai_registro`), ajustes de modelo y tope (`ai_ajustes`), gasto (`ai_uso`), quién preguntó en conversaciones, **cierra un agujero de seguridad** (las conversaciones y la agenda de IA se podían leer y borrar con la clave pública), borra los 235 avisos viejos del lector de mails. | **NO** — la aplica Juan |

## Pendientes
- [ ] Juan aplica `20261014_jarvis_cimientos.sql`.
- [ ] Para probar el chat desde esta PC hace falta la clave de Anthropic en `.env.local` (`ANTHROPIC_API_KEY=...`). La pone Juan; Claude no maneja claves. En Vercel ya está (el chat viejo anda).
- [ ] Seguridad (fuera de Jarvis, avisar): `ai_emails`, `ai_email_attachments` y `ai_classifications` siguen con acceso público total. No se tocaron porque el lector de mails viejo las lee desde el navegador. Arreglarlas cuando se retome el lector.
- [ ] Los otros usos de IA del sistema (lector de mails, analizador de Excel, búsqueda de fotos del vendedor) todavía tienen el modelo escrito a mano. Pasarlos a `lib/jarvis/modelos.ts` cuando se retome el lector de mails (probarlos uno por uno, los modelos nuevos cambian algunas reglas).

## Diario

### 14/10/2026
- Revisé el repo, la base y todos los planes viejos. Plan escrito y aprobado por Juan con ajustes (nombre **Jarvis**, nada de preguntas de relleno, plata solo admin, internet sí, tope USD 150, pantallas las hace esta sesión).
- **Etapa 0, cimientos:**
  - `lib/jarvis/modelos.ts`: el nombre del modelo en un solo lugar. Se elige por la tabla `ai_ajustes` (pantalla, con bitácora), o por variable de entorno, o por defecto: pensador = Opus 5.5, rápido = Haiku 5.5, respaldo = Sonnet 5.5. Además tiene la tabla de precios para calcular el costo.
  - `lib/jarvis/acceso.ts`: solo admin y administrativo usan Jarvis; las decisiones de plata, solo admin.
  - `lib/jarvis/registro.ts`: anotar en la bitácora inborrable. Si no se puede anotar, la acción no sigue.
  - `lib/jarvis/uso.ts`: anota cuánto costó cada llamada; si el mes pasó el tope, baja al modelo rápido.
  - Migración `20261014_jarvis_cimientos.sql` (ver arriba).
  - Chequeo obligatorio: tipos del ERP OK, formatos OK. El chequeo de las apps móviles falla en esta carpeta solo porque sus librerías apuntan a la copia vieja de `gmv2-nuevo`. No se tocó nada de las apps.
