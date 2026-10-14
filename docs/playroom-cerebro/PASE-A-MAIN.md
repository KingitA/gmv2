# Jarvis: lista para pasar a main

Rama `playroom-cerebro` → `main`. **Se pasa solo con el OK de Juan.**

## 1. Antes del merge (en la base, Supabase → SQL Editor)
Las migraciones se aplican en orden. Todas son "aditivas": no borran datos del negocio.

| # | Archivo | Estado |
|---|---|---|
| a | `20261014_jarvis_cimientos.sql` | aplicada 14/10 |
| b | `20261014b_jarvis_consultas.sql` | aplicada 14/10 |
| c | `20261014c_jarvis_vigias.sql` | aplicada 14/10 |
| d | `20261014d_jarvis_decisiones.sql` | aplicada 14/10 |
| e | `20261014e_jarvis_acciones.sql` | aplicada 14/10 |
| f | `20261014f_jarvis_retencion_registro.sql` | aplicada 14/10 |
| g | `20261014g_jarvis_mundo_exterior.sql` | aplicada 14/10 |
| **h** | **`20261014h_jarvis_revision.sql`** | **FALTA** — es la de seguridad (cierra el acceso público a charlas y agenda) y corrige consultas |

## 2. Variables en Vercel (Settings → Environment Variables, en **Production**)
- `ANTHROPIC_API_KEY`: ya existe (el chat viejo la usaba). Con saldo cargado.
- `CRON_SECRET`: tiene que existir. Sin ella, el reporte de las 5:00 no corre; queda solo el botón "Revisar ahora".
- Opcionales (si no están, se usan los ajustes de la pantalla): `JARVIS_MODELO_PENSADOR`, `JARVIS_MODELO_RAPIDO`, `JARVIS_MODELO_RESPALDO`.

## 3. Qué probar en el preview antes de dar el OK (10 minutos)
1. **Chat:**
   - *"¿cuánto vendimos el mes pasado?"*;
   - *"contame de La Banderita"*;
   - *"¿quién decidió retener a Li Yutao?"* (tiene que nombrarte, con la hora).
2. **Playroom → "Revisar ahora":** aparecen el resumen del día, "Lo que Jarvis notó" y las propuestas en "Para decidir".
3. **Una propuesta:**
   - **Recordámelo → Mañana**: tiene que **desaparecer** hasta mañana;
   - en otra, **No** con una nota.
4. **Recordatorio:** uno "para mí" y otro "para otra persona". El de la otra persona no te tiene que aparecer a vos.
5. **Ajustes de Jarvis:**
   - agregar una nota y **borrarla** (antes fallaba);
   - "Actualizar ahora" en materias primas: tienen que aparecer más que el petróleo.
6. **Retener entregas** (con un cliente de prueba):
   - Sí → armar un viaje → la parada tiene el candado;
   - Liberar → el candado sale.
7. **Doble clic:** apretar "Sí, confirmo" dos veces rápido. Tiene que hacerse **una sola vez** (la segunda dice "ya lo decidió…").

## 4. El merge
- En una carpeta aparte (no en `gmv2-nuevo`): actualizar `playroom-cerebro` con lo último de `main`, correr `npm run typecheck:movil` y mergear.
- Vercel despliega solo.

## 5. Si algo sale mal: volver atrás
- `git revert -m 1 <commit del merge>` → push. Vercel vuelve a la versión anterior.
- **Las tablas y columnas nuevas quedan** (no molestan). Ojo: con el código viejo, la "retención de entregas" **deja de aplicarse** a los viajes nuevos. Si había clientes retenidos, avisarle a la oficina que ponga el candado a mano en la hoja de ruta.
- El reporte de las 5:00 también deja de correr (sale de `vercel.json`).

## 6. Después del merge (primera semana)
- Mirar el gasto en "Jarvis: reglas y decisiones" (barra del mes).
- Clasificar el resto del catálogo con el botón (unos USD 0,12 en total).
- Correr el examen una vez por semana (`node scripts/jarvis-examen/correr.mjs`) y sumar preguntas reales de la oficina a `scripts/jarvis-examen/preguntas.json`.
