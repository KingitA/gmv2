# Jarvis: bitácora de trabajo

Acá se anota **todo lo que se va haciendo**, para retomar desde cualquier computadora o sesión.
El plan está en [PLAN.md](PLAN.md). Lo más nuevo va arriba.

**EN MAIN desde el 14/10/2026** (merge `4f23a64`, con OK de Juan después de probar). Rollback: `git revert -m 1 4f23a64`. Para seguir trabajando: rama nueva desde main.

---

## Cómo retomar (para Juan o para otra sesión de Claude)
1. Abrir la rama `playroom-cerebro` (o pedirle a Claude: "seguí con Jarvis, leé docs/playroom-cerebro/BITACORA.md").
2. Leer **"Estado actual"** y **"Pendientes"** acá abajo.
3. Las migraciones de base (archivos `supabase/migrations/2026…_jarvis_*.sql`) **las aplica Juan a mano** en Supabase → SQL Editor. En "Migraciones" dice cuáles faltan.

## Estado actual
- **15/10: Jarvis + calendario de viajes** en la rama `jarvis-calendario` (desde main 6adbb34). Código listo. Falta:
  - aplicar `20261015b_calendario_laboral.sql`;
  - probar en el preview;
  - OK de Juan para main.
- **Etapa 0 (cimientos): lista.** Migración aplicada (verificado 14/10).
- **Etapa 1 (chat nuevo): lista, falta probarla con la IA** (en el preview, o el examen con la clave en `.env.local`). Migración aplicada; las 12 consultas responden contra la base real.
- **Etapa 2 (vigías y resumen del día): lista.** Migración aplicada (14/10). Falta que exista `CRON_SECRET` en Vercel y probar "Revisar ahora" en el preview. **El reporte corre de lunes a sábado a las 5:00** (pedido de Juan; cron `0 8 * * 1-6` en hora UTC).
- **Etapa 3 (decisiones, agenda, reglas): lista.** Migración aplicada; Juan la probó ("todo andando", 14/10).
- **Etapa 4 (acciones conectadas + recordatorios por persona): lista.** Juan la probó con Li Yutao (14/10). Se arreglaron dos errores: las paradas del viaje y el historial.
- **Etapa 5 (mundo exterior): código listo.** Falta aplicar `20261014g_jarvis_mundo_exterior.sql` y, en el preview, apretar "Clasificar los que faltan" y "Actualizar ahora".
- Después: examen con la IA (con la clave en `.env.local`), pulido y pase a main con el OK de Juan.

## Migraciones
| Archivo | Qué hace | ¿Aplicada? |
|---|---|---|
| `20261014h_jarvis_revision.sql` | **Seguridad**: prende RLS en ai_agenda_events, ai_conversations y ai_messages (estaba apagada: la migración a no cerraba nada) y saca permisos a anon/authenticated. La bitácora pone siempre la hora real. Un solo aviso o propuesta vivo por clave. `viajes_paradas.retencion_puso_cobro`. Consultas corregidas. | Sí (14/10) |
| `20261014g_jarvis_mundo_exterior.sql` | `ai_insumos` (catálogo de materias primas y qué indicadores las mueven), `ai_articulo_insumos` (de qué depende cada artículo: IA o persona; las correcciones van a la bitácora), `ai_indicadores_externos` (dólar, inflación, petróleo…, con fuente), RPC `jarvis_proveedor_insumos` y 3 reglas nuevas. No toca `articulos`. | Sí (14/10) |
| `20261014f_jarvis_retencion_registro.sql` | Trigger: retener o liberar a un cliente queda SIEMPRE en la bitácora (quién y cuándo), venga de donde venga el cambio. | Sí (14/10) |
| `20261014e_jarvis_acciones.sql` | Recordatorios por persona (`para_usuario`; NULL = para todos). Clientes: `retener_entregas`, motivo, desde y quién. | Sí (14/10) |
| `20261014d_jarvis_decisiones.sql` | Decisiones en la bandeja: qué se haría con el Sí, quién decidió, cuándo, nota, resultado, impacto estimado y real. Triggers: cada alta y cada decisión van a la bitácora. Reglas iniciales de los avisos en `ai_ajustes`. | Sí (14/10) |
| `20261014c_jarvis_vigias.sql` | La agenda vieja (`ai_agenda_events`) pasa a ser la bandeja de Jarvis: clave, tono, acciones, severidad, quién y cuándo la cerró. Cada cierre hecho por una persona queda en la bitácora. | Sí (14/10) |
| `20261014b_jarvis_consultas.sql` | Consultas de Jarvis (solo lectura): ventas agrupadas, deuda por antigüedad (libro mayor + FIFO), hábitos de compra, cobertura de stock, resumen por proveedor con último aumento. | Sí (14/10) |
| `20261014_jarvis_cimientos.sql` | Bitácora inborrable (`ai_registro`), ajustes de modelo y tope (`ai_ajustes`), gasto (`ai_uso`), quién preguntó en conversaciones, **cierra un agujero de seguridad** (las conversaciones y la agenda de IA se podían leer y borrar con la clave pública), borra los 235 avisos viejos del lector de mails. | Sí (14/10) |

## Pendientes
- [x] Juan aplicó `20261014h_jarvis_revision.sql` (verificado: RLS prendida) y probó todo (14/10). **EN MAIN.**
- [x] Juan aplicó `20261014_jarvis_cimientos.sql` y `20261014b_jarvis_consultas.sql` (14/10).
- [x] Juan aplicó `20261014c_jarvis_vigias.sql` (14/10).
- [x] Juan aplicó `20261014d_jarvis_decisiones.sql` (14/10).
- [x] Juan aplicó `20261014e_jarvis_acciones.sql` y probó retener y liberar a Li Yutao (14/10).
- [x] Juan aplicó `20261014f_jarvis_retencion_registro.sql` (14/10).
- [x] Juan aplicó `20261014g_jarvis_mundo_exterior.sql` (14/10). Primera prueba: dólar, inflación y petróleo OK; 400 artículos clasificados (39 dudas, USD 0,0025 cada 80).
- [ ] Clasificar el resto del catálogo (botón, 400 por vez; unos USD 0,12 en total).
- [x] Juan cargó la clave de Anthropic en `.env.local` (14/10).
- [x] Juan cargó saldo en Anthropic (14/10). Decisión de Juan: **la calidad manda sobre el costo** (USD 70 a 150 por mes está bien); se queda Opus.
- [ ] Viaje ALTO VALLE 16/10: a la parada de Li Yutao le quedó "cobrar lo anterior" marcado (lo dejó la liberación vieja). Destildarlo en la hoja de ruta si no corresponde.
- [ ] Verificar que `CRON_SECRET` exista en Vercel. Sin eso, la revisión de las 8:00 no corre y queda solo el botón "Revisar ahora".
- [ ] Para probar el chat desde esta PC hace falta la clave de Anthropic en `.env.local` (`ANTHROPIC_API_KEY=...`). La pone Juan; Claude no maneja claves. En Vercel ya está (el chat viejo anda).
- [ ] Seguridad (fuera de Jarvis, avisar): `ai_emails`, `ai_email_attachments` y `ai_classifications` siguen con acceso público total. No se tocaron porque el lector de mails viejo las lee desde el navegador. Arreglarlas cuando se retome el lector.
- [ ] Los otros usos de IA del sistema (lector de mails, analizador de Excel, búsqueda de fotos del vendedor) todavía tienen el modelo escrito a mano. Pasarlos a `lib/jarvis/modelos.ts` cuando se retome el lector de mails (probarlos uno por uno, los modelos nuevos cambian algunas reglas).

## Diario

### 15/10/2026 — Jarvis ayuda a armar el calendario de viajes
Pedido de Juan, sobre "Armar mes" (`/viajes/planificar`, que hizo la sesión de viajes, commit ab96373).

**Decisiones de Juan:**
- Se trabaja de **lunes a viernes**.
- Importan las vacaciones de **todos**: choferes, depósito, vendedores y oficina.
- La frecuencia de cada zona es libre (cada 1; 1,5; 2; 2,5; 3; 3,5 meses…).
- Un feriado se puede marcar "trabajamos" **y cambiar después** (ej. el del Papa, en debate).
- Las vacaciones se cargan en **Ajustes → Personas**.

**Migración `20261015b_calendario_laboral.sql`:**
- `calendario_dias`: feriados y días especiales. `trabajamos` es NULL hasta que una persona decide; cada cambio va a la bitácora.
- `personal_ausencias`: no se borran, se anulan; alta y anulación van a la bitácora.
- `zonas.frecuencia_dias`: 1 = días hábiles, N = cada N días, NULL = cuando haga falta. Queda sincronizada con `en_calendario`. BAHIA arranca en 1.
- Regla `regla_dia_aviso_calendario` = 20.

**Código:**
- `lib/viajes/calendario-laboral.ts`: días hábiles, feriados de la fuente oficial (argentinadatos; lo decidido no se pisa; si un feriado desaparece de la fuente queda `en_fuente=false`), ausencias.
- `lib/viajes/plan-mes.ts`: la frecuencia decide si a una zona le "toca" el mes (última visita + N). A las diarias les faltan días hábiles. El estado del mes trae feriados, ausencias y días hábiles.
- Rutas:
  - `/api/viajes/plan/dia`: trabajamos / no trabajamos / sin decidir. Cierra la pregunta de Jarvis si estaba pendiente.
  - `/api/viajes/plan/zona`: ahora acepta `frecuencia_dias`.
  - `/api/personal/ausencias` (GET, POST) y `/api/personal/ausencias/[id]/anular`.
  - El GET del plan usa la service key, porque las tablas nuevas tienen RLS; el permiso lo controla `requireOficina`.
- Pantallas:
  - "Armar mes": feriado en el día (clic → Trabajamos / No trabajamos / Sin decidir, con quién decidió), fin de semana sombreado, 🏖 quién falta, selector de frecuencia por zona ("le toca desde…"), Bahía con "faltan N días hábiles", aviso de feriados sin decidir.
  - Nueva `/tablas/ausencias` en Ajustes → Personas.
- Jarvis:
  - acciones `dia_laboral` (botones Trabajamos / No trabajamos; el "No" también ejecuta, con `alRechazar`) y `abrir_planificador` (Armar ahora / No hace falta);
  - vigías (`lib/jarvis/vigias-calendario.ts`):
    - **dia_laboral**: feriado de los próximos 60 días sin decidir; feriado que ya no figura en la fuente pero está como "no trabajamos";
    - **armar_mes**: desde el día 20, "faltan N de M zonas", con feriados sin decidir y vacaciones del mes. Se repite hasta completar; cuando queda completo anota `calendario_completo` con quién armó los viajes;
    - **viajes_afuera**: zonas a las que les toca y no tienen viaje, días de Bahía sin viaje en los próximos 14 días, viaje en un día que no se trabaja o en un feriado sin decidir, chofer asignado de vacaciones;
  - la revisión diaria trae los feriados del año y del que viene;
  - herramientas de chat `calendario_viajes` y `ausencias_personal`;
  - los botones de los avisos pueden llevar a una pantalla (`href`).
- Probado solo leyendo, sin la migración:
  - octubre: 19 zonas sin viaje (hay 2 viajes cargados);
  - noviembre: 21 zonas;
  - los vigías corren.
- Tipos y formatos OK.

### 14/10/2026 — EN MAIN
- Merge `4f23a64` (main no había cambiado desde 795089b: pase limpio). Las 8 migraciones están aplicadas. Pendientes de la primera semana en `PASE-A-MAIN.md` §6.

### 14/10/2026 (noche) — Revisión general del código (3 revisores en paralelo)
- **Chat e IA:**
  - la fecha de las materias primas había perdido las barras al editarla, así que **no se guardaba nada** buscado en internet;
  - un usuario podía escribir en la charla de otro, y la pantalla podía mandar un historial falso. Ahora **el historial sale solo de la base y es de quien pregunta**; la pantalla ya no lo manda;
  - las charlas crecían sin límite: pasando ~500 mil caracteres siguen en una nueva, con un repaso de lo último;
  - el gasto del mes se cortaba en 1.000 filas (el tope nunca saltaba);
  - las consultas se cortaban en 1.000 filas (ahora van por páginas);
  - pagos y cheques se cortaban en 500;
  - si responde otro modelo (respaldo o el rápido), se le manda el historial sin el razonamiento de Opus;
  - un turno cortado en una búsqueda en pausa ya no se guarda;
  - `recalcular` ahora sabe quién mira;
  - 29 de febrero y fechas inválidas.
- **Agenda y decisiones:**
  - **un doble clic podía ejecutar dos veces**: ahora la decisión se toma de forma atómica, solo si sigue pendiente;
  - si se hace pero no se puede cerrar, se dice la verdad y el barrido diario destraba lo que quedó "en curso" más de 15 minutos;
  - propuestas duplicadas: índice único y `limit(1)`;
  - los vigías ya no pisan una decisión humana (filtran por "pendiente") y no usan ventanas fijas de 2.000 filas;
  - **una propuesta del chat podía tener el id de otro cliente**: ahora los ids nunca vienen de la IA y la agenda muestra "Cliente: X";
  - "Recordámelo" no escondía la propuesta;
  - "Liberar" podía liberar a otro cliente con el mismo nombre;
  - liberar borraba un "cobrar lo anterior" puesto por oficina: ahora existe `retencion_puso_cobro`;
  - si falla la verificación de retenidos, el armado del viaje se frena; antes la parada salía sin candado;
  - borrar una nota fallaba;
  - la orden de compra de Jarvis cargaba unidades como bultos.
- **Base:**
  - **seguridad (lo más grave):** RLS apagada en 3 tablas, así que se podía falsificar un "Sí" a nombre de otro;
  - la hora de la bitácora la ponía quien insertaba;
  - deuda con proveedores inflada 2,4 veces por los vencimientos estimados (ahora van aparte);
  - el costo no restaba las notas de crédito;
  - las bajas de precio contaban como "aumentó";
  - el registro de retención podía culpar a quien no fue;
  - notas de débito;
  - índice para el historial de precios;
  - funciones jarvis_* solo para el servidor.
- Todo verificado:
  - tipos OK;
  - las 14 herramientas y los vigías contra la base real, solo lectura;
  - las funciones nuevas probadas como SELECT;
  - 3 preguntas del examen con la IA: 9,7/10.

### 14/10/2026 (noche) — Examen completo y esfuerzo
- **Opus 5.5 con esfuerzo normal y las instrucciones ajustadas: 8,8/10, reglas OK 19 de 20, USD 0,78.**
- **Con esfuerzo alto: 8,7/10, el mismo costo.** No mejora, así que **queda en normal**. Igual quedó como ajuste `esfuerzo_chat` en la pantalla (solo admin), para probarlo de nuevo con modelos futuros.
- Jarvis dejaba propuestas solo al responder preguntas comunes (ej. "contame de La Banderita" → proponía retenerle las entregas). Ahora **propone solo si se lo piden**; si ve algo, lo sugiere en una línea. Las propuestas automáticas las hacen los vigías.
- Re-examen de las 3 más flojas: cliente que más debe 6 → 9, deuda +30 días 8 → 10, ficha de cliente 8 → 9 (promedio 9,3).

### 14/10/2026 (noche) — Primer examen de Jarvis
- **Corrida 1 (Opus 5.5): nota 8,6/10, reglas OK 18 de 20, USD 0,74.** Números correctos en las 20 preguntas.
- Fallas, todas de forma:
  - "¿cómo venimos?" 6/10: se alargó con 5 viñetas y calculó un ticket propio que no cerraba;
  - "¿cuántos pedidos para preparar?": demasiado análisis para una pregunta que pedía un número;
  - "borrá el pedido": cerró con un ofrecimiento ("si querés…"), que también es relleno;
  - ficha de cliente sin "cada cuánto compra";
  - "Iberia debe" cuando somos nosotros los que le debemos.
- Ajuste de instrucciones:
  - responder exactamente lo pedido, con una sola observación como mucho;
  - nada de ofrecimientos al final;
  - nada de cuentas propias salvo sumas y restas;
  - con los proveedores, decir "le debemos a";
  - en la ficha de un cliente, siempre deuda y antigüedad, frecuencia de compra y última compra.
- **Corrida 2:** 11 preguntas respondidas, promedio 8,9 (antes 8,6 en esas mismas). Ficha 7 → 8, pedidos para preparar 8 → 9, dejaron de comprar 8 → 9. Las otras 9 fallaron porque **se acabó el saldo de la cuenta de Anthropic**.
- Los resultados quedan en `scripts/jarvis-examen/resultados/`, para comparar contra el próximo modelo.

### 14/10/2026 (noche) — Ajuste: materias primas
- La primera búsqueda pidió las 6 materias primas juntas, con 12 búsquedas en total. Las gastó en el petróleo y volvió solo ese (USD 0,33).
- Ahora busca **cada una por separado y en paralelo**, con hasta 4 búsquedas cada una. Si no encuentra el indicador exacto, puede usar la referencia más cercana y lo aclara en "fuente".

### 14/10/2026 (noche) — Etapa 5, mundo exterior
- **Precios de afuera** (`lib/jarvis/exterior.ts`):
  - **Dólar oficial, dólar blue e inflación:** fuente pública gratis (api.argentinadatos.com), con historia. Sin IA, todos los días.
  - **Materias primas** (petróleo Brent, resina de polietileno, celulosa, aluminio, acero, algodón): Jarvis las busca en internet una vez por semana. Guarda el valor actual y el de hace unos 30 días, con fuente y link. No hay páginas fijas: si una deja de andar, la búsqueda encuentra otra.
  - Solo se buscan las materias primas que usan los artículos clasificados.
- **Clasificador** (`lib/jarvis/clasificador.ts`):
  - La IA barata (modelo rápido) decide de qué depende el costo de cada artículo, en tandas de 80 y con una lista cerrada de 9 materias primas. Guarda confianza y motivo.
  - Cada mañana clasifica hasta 400 artículos nuevos. El botón "Clasificar los que faltan" hace 400 más cada vez que se aprieta.
  - Lo que confirma o corrige una persona (`fuente = persona`) **no lo pisa nunca**, y queda en la bitácora.
  - Las dudas (confianza menor a 0,7) se listan para revisar.
- **Perfil de proveedor** (RPC `jarvis_proveedor_insumos`): qué parte de lo que le vendemos depende de cada materia prima.
- **Vigía "compra anticipada"** (el ejemplo del petróleo del plan): se activa cuando se cumplen las tres condiciones:
  - una materia prima sube un 10 % o más en 30 días;
  - un proveedor depende de ella en un 50 % o más;
  - ese proveedor no aumenta hace 45 días o más (o no tiene aumentos desde el 18/09).

  Con eso propone "¿Armamos un pedido antes?" con el ahorro estimado (lo que le compramos por mes por la suba). El Sí abre la orden de compra prellenada. No se propone si ya tiene una orden abierta. Los tres umbrales son reglas editables.
- La revisión de las 5:00 hace, en orden: precios fijos, clasificación de los nuevos, materias primas (semanal), vigías y resumen. El resumen menciona lo de afuera solo si se movió fuerte. Tiempo máximo: 300 segundos.
- Chat, 3 herramientas nuevas: `indicadores_externos`, `insumos_proveedor` y `clasificacion_articulos`.
- Pantalla, en "Jarvis: reglas y decisiones" → "Materias primas y precios de afuera":
  - tabla de indicadores con la variación en 30 días y la fuente;
  - barra de cobertura de la clasificación;
  - lista de dudas con Confirmar / Corregir.

### 14/10/2026 (noche) — Arreglo: "¿quién liberó a Li Yutao?"
- Jarvis respondió que **nadie** la había liberado y supuso que había sido "por fuera". **Era falso:** la bitácora tenía `liberar_entregas_manual` de Juan Cruz a las 14:09.
- **Causa:** el historial usaba una lista de acciones permitidas y esa no estaba.
- **Arreglos:**
  - el historial ahora muestra todo, salvo la foto y el resumen diario;
  - las instrucciones dicen que, si no lo encuentra, lo diga y **no suponga**;
  - al liberar, también se saca "cobrar lo anterior" que había puesto la retención;
  - el registro de retener o liberar lo escribe la **base** (trigger `clientes_registrar_retencion`), en el mismo paso que el cambio, venga de donde venga. El botón Liberar ya no anota aparte, para no duplicar.
- Verificado leyendo producción: `historial_decisiones` para Li Yutao devuelve "Juan Cruz · Liberó las entregas (desde Ajustes) · 14/10 14:09".

### 14/10/2026 (noche) — Arreglo: viaje con cliente retenido
- **Error que encontró Juan en el preview:** al armar un viaje (ALTO VALLE 16/10) con Li Yutao retenido, falló el alta de las paradas (`exigir_cobro_anterior` llegaba vacío). Los 2 pedidos quedaron en el viaje, pero sin paradas, y la pantalla mostraba "no hay pedidos".
- **Causa:** en un insert de varias filas, PostgREST manda NULL a una columna que falta en alguna fila (no usa el default). Las filas de clientes no retenidos no llevaban los campos del candado.
- **Arreglo:** todas las filas llevan `bloquear_entrega`, `exigir_cobro_anterior` y `motivo_bloqueo` explícitos.
- **Autorreparación:** se agregó `repararParadasFaltantes`. Al abrir la hoja de ruta de un viaje programado con pedidos sin parada, las crea. Así se arregla solo el viaje de Juan.
- Producción (main) no estaba afectada: el cambio vive solo en la rama.

### 14/10/2026 (noche) — Etapa 4, acciones conectadas y recordatorios por persona
- **Recordatorios por persona** (decisión de Juan):
  - las **propuestas** las ven todos, porque son decisiones de la empresa;
  - los **recordatorios** son de quien los pide; también pueden ser "para todos" o "para otra persona" ("recordale a Mario…");
  - un recordatorio personal lo cierra esa persona, quien lo pidió o un admin.
- **Retener entregas** (`lib/viajes/retencion.ts`):
  - Antes el candado existía solo por parada. Ahora hay `clientes.retener_entregas` (con motivo, desde y quién).
  - `sincronizarParadas` (`lib/viajes/servidor.ts`) hace nacer la parada de un cliente retenido con "NO ENTREGAR SIN COBRAR" y "cobrar lo anterior".
  - Al retener, también se bloquean las paradas pendientes de viajes ya armados, hasta que el chofer finaliza (misma regla que la pantalla de viajes).
  - Al liberar, solo se destraban las paradas con motivo "Retenido: …". El candado que puso oficina a mano se respeta.
  - La app del chofer y la hoja de ruta ya muestran `bloquear_entrega`: no hubo que tocarlas.
- **Acciones del "Sí"** (`lib/jarvis/acciones.ts`): `retener_entregas`, `liberar_entregas` y `armar_orden_compra`.
  - La orden de compra **no se crea sola**, porque crearla mueve la cuenta del proveedor y el kardex.
  - El Sí abre `/ordenes-compra?nueva=1&proveedor=…&sugerir=1&origen=jarvis`: el formulario de siempre con la **sugerencia que ya existía** (`/api/ordenes-compra/sugerencia`) cargada como cantidad pedida y la observación "Sugerida por Jarvis". La guarda una persona.
- **Vigías**:
  - "Volvió a pedir debiendo" ahora es una **propuesta** "¿Le retengo las entregas hasta que pague?" en "Para decidir". Si ya está retenido, no se propone.
  - Vigía nuevo "retenido al día": si un cliente retenido ya no tiene deuda vencida, propone "¿Le libero las entregas?".
  - Si dicen que no, no se insiste salvo que la deuda crezca un 25 %. Si deja de hacer falta antes de que alguien decida, se cierra sola.
- Chat: herramienta `clientes_retenidos`. `proponer_decision` resuelve el cliente o proveedor y arma los datos de la acción.
- Ajustes de Jarvis: sección "Clientes con entregas retenidas" con el botón **Liberar**. Primero anota en la bitácora y después libera.
- Prueba sin escribir (solo detección) contra la base real: 4 propuestas de retener (Li Yutao, Xiao Yu, Weng Biao, Lin Xuehua) y 5 avisos.
- Los 9 avisos viejos "deuda-y-compra" que quedaron del test de Juan se van a cerrar solos en la próxima revisión, porque ahora son propuestas.

### 14/10/2026 (noche) — Etapa 3, decisiones, agenda y reglas
- Juan: el reporte va de lunes a sábado a las **5:00**. Cron cambiado a `0 8 * * 1-6` (Vercel usa hora UTC).
- **Bandeja de Jarvis** (`ai_agenda_events`), con tres tipos:
  - **aviso**: lo que nota un vigía;
  - **propuesta**: Sí / No / Recordámelo;
  - **recordatorio**: para una fecha.
- **Cada alta y cada decisión pasan por trigger a la bitácora inborrable (`ai_registro`):** quién, cuándo, nota, qué se iba a hacer y el resultado.
- `lib/jarvis/acciones.ts`: lo que pasa con un "Sí".
  - Por ahora solo "ninguna" (anotar) y "tarea". En la etapa 4 se suman las acciones que tocan el sistema.
  - Regla de oro: **la IA nunca ejecuta**. Ejecuta el sistema con el Sí de una persona, por el mismo camino de la pantalla.
  - Lo que mueve plata (`mueveDinero`) lo confirma **solo un admin**.
- `lib/jarvis/agenda.ts`: crear recordatorio o propuesta, decidir y ver lo pendiente con nombres.
  - Un "No" a algo urgente exige nota.
  - El "Sí" primero se anota y después se ejecuta: si no se puede anotar, no se hace nada; si la ejecución falla, vuelve a la agenda.
- `lib/jarvis/reglas.ts`: los umbrales de los vigías y las **notas del negocio** se guardan en `ai_ajustes`, que registra quién y cuándo. Una nota borrada queda con valor vacío, así el borrado también se registra. Jarvis lee las notas antes de responder.
- Chat, 4 herramientas nuevas: `agendar_recordatorio`, `proponer_decision`, `ver_agenda` y `historial_decisiones`. Las dos primeras **solo escriben en la agenda de Jarvis**, nunca en datos del negocio. `/recalcular` no las corre nunca y en el examen no escriben.
- Rutas:
  - `/api/playroom/agenda`: GET y POST.
  - `/api/playroom/agenda/[id]/decidir`.
  - `/api/playroom/jarvis`: reglas, notas, modelo y tope. Modelo y tope, solo admin.
  - `/api/playroom/jarvis/historial`.
- Pantallas:
  - "Para decidir y recordar" en Playroom (`components/playroom/jarvis-agenda.tsx`). El Sí pide "¿Confirmás? Queda a tu nombre".
  - Nuevo informe "Jarvis: reglas y decisiones" (`components/playroom/jarvis-ajustes.tsx`): reglas, notas, modelo y gasto del mes, historial.
  - Si "solo urgentes" está elegido, "Lo que Jarvis notó" muestra solo los rojos.
- No probado en pantalla: Claude no puede iniciar sesión. Se prueba en el preview.

### 14/10/2026 (noche) — Etapa 2, vigías y resumen del día
- **No se creó ninguna tabla.** La agenda vieja `ai_agenda_events` pasa a ser la **bandeja de Jarvis** (`event_type = aviso`). El resumen del día y la "foto" diaria de los números van a la bitácora inborrable (`ai_registro`, acciones `resumen_del_dia` y `foto_diaria`).
- `lib/jarvis/vigias.ts`: 7 vigías sin IA. Primera corrida contra la base real (solo lectura), 9 avisos en 4 segundos:
  - 174 cheques en cartera vencidos o por vencer ($ 288 M; 150 con fecha de hace más de 30 días, o sea que nadie los está dando de baja);
  - $ 8,5 M atrasados a proveedores y $ 95,8 M que vencen esta semana;
  - 88 artículos con stock para menos de 7 días;
  - 17 clientes habituales que dejaron de comprar ($ 15,3 M por mes);
  - 3 cobros sin verificar en Caja ($ 7,5 M);
  - **4 clientes que volvieron a pedir debiendo más de 30 días** (el caso del plan).
- Un aviso descartado no vuelve, salvo que empeore un 25 % o más. Si deja de cumplirse, se cierra solo. Si un vigía falla, sus avisos no se cierran por error.
- `lib/jarvis/resumen.ts`: corre la revisión diaria (vigías + foto + resumen escrito por la IA).
- Rutas:
  - `/api/cron/jarvis-revision`: lunes a sábado a las 8:00 (`vercel.json`). Exige `CRON_SECRET`.
  - `/api/playroom/resumen-del-dia`: lee el resumen guardado.
  - `/api/playroom/novedades`: GET lee los avisos; POST es "Revisar ahora", una vez cada 10 minutos como máximo.
  - `/api/playroom/novedades/[id]/descartar`.
- Pantalla: botón "Revisar ahora", hora de la última revisión, ✕ para descartar cada aviso y el avatar "J".

### 14/10/2026 (tarde) — Etapa 1, chat nuevo
- **Hallazgo:** la vista `v_aging_clientes` NO coincide con la deuda oficial: da $ 47,8 M contra $ 35,4 M del libro mayor. Además, su zona sale de una tabla casi vacía. Jarvis no la usa: la antigüedad se calcula sobre el libro mayor (`jarvis_deuda_antiguedad`). Conviene revisar quién más usa esa vista (¿reporte de Cuentas corrientes de Playroom?).
- **Datos flojos que Jarvis avisa solo:**
  - costos: el margen de septiembre da 71 %, lo que es imposible; hay artículos sin costo;
  - stock: 187 artículos activos con stock negativo;
  - importaciones de listas: `importaciones_articulos` tiene solo 6 filas, sin proveedor. Para saber "cuándo aumentó un proveedor" se usa el historial de precios (`precio_insumos_historial`, desde el 18/09).
- Las cuentas del tablero pasaron a `lib/playroom/indicadores.ts`. La pantalla y Jarvis usan las mismas.
- `lib/jarvis/`:
  - `periodos.ts`: "mes_actual", "ultimos_30_dias"… Las tarjetas fijadas guardan el nombre del período.
  - `herramientas.ts`: 12 consultas de solo lectura, cada una con su bloque y "recalcular".
  - `instrucciones.ts`: cómo se comporta Jarvis. Reglas de Juan: corto, sin preguntas de relleno, cada número de una herramienta.
  - `cerebro.ts`: el circuito. Usa el modelo de los ajustes, con respaldo si falla. Anota el costo. Busca en internet.
  - `conversaciones.ts`: guarda quién preguntó qué.
- Rutas:
  - `/api/playroom/chat`: reescrita. Solo admin y administrativo. Guarda la conversación en el servidor.
  - `/api/playroom/recalcular`: nueva. Actualiza tarjetas fijadas sin IA.
- Pantalla: el chat se llama **Jarvis** (`components/playroom/jarvis-panel.tsx`) y muestra mensajes que van cambiando mientras piensa.
- **Examen:** `scripts/jarvis-examen/` tiene 20 preguntas, entre ellas trampas: año pasado sin datos, "borrá un pedido", nombre ambiguo y dólar por internet. Un juez pone nota de 0 a 10.
  - Uso: `node scripts/jarvis-examen/correr.mjs [modelo]`.
  - Necesita `ANTHROPIC_API_KEY` en `.env.local`.
  - No escribe en la base.
- Probado contra la base real (solo lectura), sin IA: las herramientas que no dependen de la migración nueva responden en 0,2 a 4 segundos. Las consultas nuevas se probaron como SELECT: 0,2 a 2 segundos.

### 14/10/2026
- Revisé el repo, la base y todos los planes viejos. Plan escrito y aprobado por Juan con ajustes (nombre **Jarvis**, nada de preguntas de relleno, plata solo admin, internet sí, tope USD 150, pantallas las hace esta sesión).
- **Etapa 0, cimientos:**
  - `lib/jarvis/modelos.ts`: el nombre del modelo en un solo lugar. Se elige por la tabla `ai_ajustes` (pantalla, con bitácora), o por variable de entorno, o por defecto: pensador = Opus 5.5, rápido = Haiku 5.5, respaldo = Sonnet 5.5. Además tiene la tabla de precios para calcular el costo.
  - `lib/jarvis/acceso.ts`: solo admin y administrativo usan Jarvis; las decisiones de plata, solo admin.
  - `lib/jarvis/registro.ts`: anotar en la bitácora inborrable. Si no se puede anotar, la acción no sigue.
  - `lib/jarvis/uso.ts`: anota cuánto costó cada llamada; si el mes pasó el tope, baja al modelo rápido.
  - Migración `20261014_jarvis_cimientos.sql` (ver arriba).
  - Chequeo obligatorio: tipos del ERP OK, formatos OK. El chequeo de las apps móviles falla en esta carpeta solo porque sus librerías apuntan a la copia vieja de `gmv2-nuevo`. No se tocó nada de las apps.
