# Jarvis, el cerebro de Playroom: plan

**Rama:** `playroom-cerebro` (sale de main 795089b, 14/10/2026). **Carpeta:** `Desktop/gmv2-cerebro`.
**Estado:** borrador para que lo lea Juan. Nada programado todavía.

---

## 1. La idea en una frase

Jarvis es un **empleado nuevo que lee todo el sistema y nunca firma nada solo**.
Mira los números todos los días, te avisa lo raro, te propone qué hacer y te recuerda lo que ya decidiste.
**Cada decisión la toma una persona, con nombre y hora**, y queda anotada para siempre.

## 2. Qué hay hoy (lo que se aprovecha)

| Qué | Estado | Qué hacemos |
|---|---|---|
| Pantalla de Playroom (tablero, tarjetas, panel de chat, "Lo que Jarvis notó", resumen del día) | **Hecha y en main.** La armó la sesión de diseño. | Se usa tal cual. El cerebro se enchufa atrás. |
| Chat actual (`/api/playroom/chat`) | Anda, pero con un modelo viejo (Sonnet 4.6) y 4 consultas. No devuelve tablas ni gráficos ordenados. **Cualquier usuario logueado lo puede usar, incluso un chofer.** | Se reescribe. |
| Resumen del día, "Lo que notó", actualizar tarjetas fijadas | **La pantalla los pide pero no existen.** Hoy salen vacíos. | Se construyen. |
| Consultas rápidas en la base (ventas, stock, artículos vendidos, comisiones, rotación) | Hechas y andando. | Se reutilizan. |
| 22 indicadores del tablero | Hechos. | El chat usa **las mismas cuentas**, así chat y tablero nunca dicen números distintos. |
| Agenda vieja de la IA (`ai_agenda_events`, 235 renglones) | Era del lector de mails, que quedó muerto. Casi todo es spam de marzo y abril. **No guarda quién hizo cada cosa.** | Se recicla como **la agenda de Jarvis**. Se le agrega quién y cuándo, y se limpian los renglones viejos (con tu OK). |
| Conversaciones viejas (`ai_conversations` / `ai_messages`) | 16 charlas del chat viejo. | Se reciclan para guardar **quién preguntó qué**. |
| Bloqueo de entrega | Existe **por parada de un viaje** ("🔒 NO ENTREGAR SIN COBRAR"). No existe por cliente. | Se agrega "retener entregas a este cliente", que se copia solo a la parada cuando arman el viaje. |
| Orden de compra | Existe el formulario. Al guardar ya mueve la cuenta del proveedor y el stock a recibir. | Jarvis **no la crea**. Deja la propuesta lista y el botón abre el formulario de siempre ya cargado. La guarda una persona. |
| Historial de precios por versión (`precio_insumos_historial`) e importaciones de listas | Existen desde septiembre. | Con eso sabe "a este proveedor no le cargamos lista nueva hace 2 meses". |
| Precedentes de "la máquina propone, la persona confirma" | Pedido en revisión del vendedor, sugerencia de viaje por zona, cierre de caja con doble firma. | Mismo criterio. |

**Datos a tener en cuenta:** las ventas renglón por renglón arrancan en **junio 2026** (4 meses y medio). Jarvis tiene que saberlo y no inventar tendencias de "el año pasado".

## 3. Cómo funciona: tres pisos

### Piso 1: preguntar (chat)
- Le escribís como a una persona: *"¿Qué clientes de Tres Arroyos deben más de 60 días?"*
- Jarvis arranca diciendo qué revisó (*"Revisé cuentas corrientes de 41 clientes…"*). Después responde corto y al grano, con tablas y gráficos del sistema.
- **Nada de "¿querés que revisemos otra cosa?"** (regla de Juan, 14/10). Jarvis propone seguir **solo si encontró algo concreto que pesa** sobre lo que se está viendo. Ejemplo válido: *"Viendo Tres Arroyos: Necochea está igual o peor en cuentas corrientes, ¿lo miramos?"* Si no hay nada así, termina y se calla. Esto queda en el examen de calidad: una respuesta con relleno o preguntas de compromiso cuenta como mal.
- Toda tabla o número se puede **fijar en el tablero** y se actualiza solo.
- **Solo lee.** Desde el chat no se puede cambiar nada.

### Piso 2: vigilar (avisos y resumen del día)
- Todas las mañanas (y si hace falta cada hora en horario de oficina) corre una revisión automática con una lista de **"vigías"**. Son reglas fijas, rápidas y baratas:
  - cliente habitual que dejó de comprar;
  - cliente que **volvió a comprar teniendo deuda vencida**;
  - deuda vencida que crece;
  - artículo que se vende más rápido y le quedan pocos días de stock;
  - margen de un rubro que bajó después de una lista nueva de proveedor;
  - proveedor que hace mucho no aumenta mientras sus pares sí;
  - pagos a proveedores que vienen contra la plata disponible;
  - cheques por vencer, cobros sin verificar en Caja hace días, pedidos trabados.
- Lo que encuentran pasa por la IA. Ella lo redacta, lo ordena por importancia y escribe el **resumen del día** ("Octubre viene 12 % arriba… el jueves vencen $ 9,2 M").
- Queda guardado. Abrir Playroom **no gasta IA**: lee lo ya calculado.
- Un aviso que ya viste y descartaste **no vuelve a aparecer igual** salvo que empeore.

### Piso 3: proponer, decidir y recordar (lo nuevo)
Ejemplo con tu caso:

> **Jarvis:** "Ferretería X volvió a pedir y debe $ 840.000 hace 45 días. ¿Retengo las entregas para que el chofer no baje mercadería si no cobra?"
> Botones: **[Sí, retener]** · **[No]** · **[Recordámelo el lunes]**

1. **La propuesta** queda anotada: qué vio, con qué números y qué propone.
2. **Una persona con permiso aprieta un botón.** Queda anotado **quién, cuándo y por qué** (nota opcional; obligatoria si dice que no a algo urgente).
3. **Lo ejecuta el sistema, no la IA**, por el mismo camino que usaría una persona: la misma función que el botón de la ficha del cliente. Si algo falla, queda anotado y vuelve a la agenda.
4. **Seguimiento:** "Retenido hasta que pague". Cuando paga, Jarvis avisa: "Ferretería X pagó, ¿libero las entregas?". Se decide de nuevo y se anota de nuevo.
5. **El registro no se puede borrar ni editar.** Cada cambio es un renglón nuevo, como el historial de viajes que ya existe. Se puede preguntar: *"¿Quién decidió retener a Ferretería X y cuándo?"*

La **agenda** guarda también lo que decidís en el chat: *"Recordame el 1° de noviembre revisar precios de Lanín"*. Ese día aparece en Playroom con tu nombre y con qué se había hablado.

## 4. Qué puede hacer y qué no

**Puede:**
- leer todo el sistema (ventas, cobranzas, deudas, stock, compras, proveedores, viajes, cheques, comisiones);
- buscar en internet datos del mundo: petróleo, dólar, inflación, noticias de un rubro (si lo aprobás, ver §8);
- proponer acciones y dejar listos los papeles (orden de compra prellenada, lista de clientes a llamar);
- recordar decisiones y avisar cuando se cumple la condición ("pagó", "llegó la fecha", "bajó el stock").

**No puede, nunca:**
- emitir, modificar ni anular facturas, notas de crédito ni nada fiscal;
- mover plata: cobrar, pagar, confirmar en Caja, anular cobranzas;
- cambiar precios directamente. Como mucho propone un **precio programado**, que confirma una persona;
- borrar nada;
- mandar mensajes a clientes o proveedores por su cuenta;
- decidir sola. Sin un "sí" de una persona con permiso, nada pasa.

## 5. Tu ejemplo del petróleo, paso a paso
1. **Afuera:** una vez por semana, Jarvis busca el precio del petróleo, el dólar y la inflación, y lo guarda.
2. **Adentro:** cada proveedor tiene anotada su **materia prima principal** (plástico, papel, químicos…). Esto hay que cargarlo una vez. Jarvis propone la lista y vos la confirmás.
3. **El vigía cruza:** "petróleo +15 % en el mes" + "Plásticos Lanín es plástico" + "a Lanín no le cargamos lista nueva hace 2 meses" + "los otros de plástico ya aumentaron".
4. **Propone:** "Te sugiero adelantar compra a Lanín. Esto es lo que vendemos de ellos por mes y el stock que queda. [Armar orden sugerida]".
5. El botón abre el formulario de orden de compra **ya cargado**. Lo revisás, lo cambiás y lo guardás vos. Queda anotado que la orden salió de esa sugerencia y quién la aprobó.

## 6. Que no quede viejo ni se trabe en 6 meses
- **El modelo se cambia en un solo lugar.** Hoy el nombre del modelo está escrito a mano en 6 archivos distintos. Lo pasamos a un único ajuste con dos modelos:
  - **pensador:** Opus 5.5 hoy. Chat y resumen del día.
  - **rápido:** Haiku 5.5 hoy. Tareas chicas, como redactar un aviso.

  El día que salga uno mejor se cambia ese ajuste, sin tocar el programa. Si el modelo principal falla, el sistema pasa solo a uno de respaldo.
- **Examen antes de cambiar de modelo:** armamos ~30 preguntas reales con su respuesta correcta sacada de la base ("¿cuánto se vendió en septiembre?", "¿quién debe más?"). Antes de cambiar de modelo se corre el examen. Si saca menos nota, no se cambia.
- **La IA nunca recibe miles de renglones.** Las cuentas las hace la base de datos y a la IA le llegan resúmenes. Con 600 clientes o con 6.000 tarda lo mismo.
- **Los clientes, proveedores y artículos nuevos entran solos.** Nada está escrito a mano en las instrucciones. Todo sale de la base en el momento.
- **Las reglas del negocio se cargan, no se programan.** Una lista de **"cosas que Jarvis tiene que saber"** que se edita desde la pantalla, por ejemplo: "Lanín = plásticos" o "a Grondona nunca se le bloquea sin hablar con Juan". Cada una dice quién la cargó y cuándo. Si Jarvis "aprende" algo charlando, propone guardarlo y una persona lo aprueba.
- **Control de gasto:** cada pregunta registra cuánto costó. Hay un **tope mensual**: si se pasa, Jarvis avisa y baja al modelo rápido.

## 7. Costo estimado (orientativo)
Con los precios de hoy de Opus 5.5:
- una pregunta típica al chat cuesta **entre 3 y 10 centavos de dólar**;
- la revisión diaria con resumen cuesta **menos de 1 dólar por día**.

Con uso normal de oficina (unas 30 preguntas por día) da **entre USD 40 y 100 por mes**. Se mide de verdad en la primera semana y se ajusta.

## 8. Etapas (cada una se prueba antes de seguir)

| # | Etapa | Qué vas a ver |
|---|---|---|
| 0 | **Cimientos** | Modelo en un solo lugar. Solo admin y administrativo usan Jarvis. Cada pregunta queda guardada con quién la hizo. El examen de 30 preguntas. |
| 1 | **Chat nuevo** | Respuestas con tablas y gráficos, "Revisé…" y preguntas para seguir. Las tarjetas fijadas se actualizan solas. Herramientas nuevas: deuda por antigüedad, compras y proveedores, cobertura de stock, pedidos y viajes, cheques, pagos que vienen. |
| 2 | **Vigías + resumen del día** | El resumen arriba de Playroom y "Lo que Jarvis notó" con datos reales, calculados cada mañana. |
| 3 | **Decisiones y agenda** | Los botones Sí / No / Recordámelo. El registro con nombre y hora que no se puede borrar. "Mis pendientes". "Recordame tal cosa" desde el chat. |
| 4 | **Acciones conectadas** | Retener entregas a un cliente (llega solo al viaje del chofer). Orden de compra prellenada. Precio programado propuesto. |
| 5 | **Mundo exterior** | Petróleo, dólar e inflación. Materia prima de cada proveedor. Sugerencias de compra anticipada. |

La etapa 4 toca cómo se arman las paradas del viaje. Si hay otra sesión trabajando en viajes, se coordina antes.

## 9. Respuestas de Juan (14/10/2026)
1. **Regla nueva aprobada:** lee y propone → una persona confirma → el sistema ejecuta → todo queda anotado.
2. **Confirman admin y administrativo. Todo lo que mueva plata, SOLO admin** (ej. futuros pagos con APIs bancarias).
3. **Lo usan admin y administrativo.** Después se lleva a las apps de vendedores, choferes, campañas de venta: el cerebro se arma pensando en eso (permisos por rol y por "qué datos ve cada uno").
4. **Internet: SÍ, obligatorio.** Materias primas, empresas, competencia.
5. **Gasto proporcional a lo que hace ganar o ahorrar.** Arranque: tope de USD 150/mes. Cada decisión guarda **cuánto se estima que gana o ahorra** y después **cuánto pasó de verdad** (ej. "se cobraron $ 840.000 retenidos"), así se puede justificar subir el gasto con números.
6. **Borrar los 235 avisos viejos** del lector de mails. El lector se retoma más adelante (listas de precios, pagos de clientes) y va a usar el mismo cerebro.
7. **Las pantallas nuevas las hace esta sesión**, con el estilo de Playroom.
8. **El agente se llama JARVIS**, no Jarvis.

## 10. Qué hace la IA sola y qué definen ustedes

**Regla general:** los **datos** los completa la IA; las **políticas** (cuánto riesgo aceptamos, a quién no se toca) las define una persona. La IA propone un valor inicial para todo, para que nadie arranque de una hoja en blanco.

### 10.1 Datos que completa Jarvis solo (y se mantienen solos)
| Dato | Cómo lo saca | Cuándo |
|---|---|---|
| **De qué depende el costo de cada artículo** (plástico → petróleo y dólar; papel → celulosa; químicos → dólar; importado → dólar…) | Lee descripción, rubro, categoría, marca y proveedor. Ej.: "FUENTON X 60 LT PLASTIC HOUSE" → plástico. Si no está seguro, busca la marca en internet. | Los 3.933 artículos una vez; después **cada artículo nuevo o importado se clasifica solo**. |
| **De qué depende cada proveedor** | Sale de sus artículos ("80 % de lo que nos vende Plastic House es plástico") + lo que encuentre en internet de la empresa. | Se recalcula solo cuando cambian sus artículos. |
| **Precio de materias primas e indicadores** (petróleo, dólar oficial y blue, inflación, celulosa, resinas…) | Busca en internet. Guarda **valor, fecha y de dónde lo sacó**. Si una página deja de andar, busca otra. | Semanal (dólar, diario). |
| **Qué indicadores seguir** | No es una lista fija: sale de lo que haga falta según cómo quedaron clasificados los artículos. Si mañana entra un proveedor de aluminio, Jarvis suma "aluminio". | Automático. |
| **Cuánto pega cada indicador en cada proveedor** | Compara las listas de precios que fue cargando cada proveedor contra cómo se movieron dólar, petróleo, etc. Mientras hay poca historia (precios desde sept. 2026) dice "estimado"; con los meses aprende solo. | Cada vez que se carga una lista nueva. |
| **Qué es "normal"** (cada cuánto compra un cliente, cuánto vende un artículo, cuánto tarda en pagar) | Sale del historial de cada uno. No hay que cargarlo. | Diario. |

### 10.2 Cómo sabemos que no queda nada afuera
- **Tablero de cobertura** en Jarvis: *"3.933 artículos: 3.870 clasificados, 48 con duda, 15 sin datos"*. Lo mismo para proveedores y clientes.
- Solo lo **dudoso** pasa a una persona, en una lista corta con la propuesta de Jarvis: "¿Esto es plástico? Sí / No / Otro". Lo que no tiene dudas no molesta a nadie.
- Lo nuevo (artículo, proveedor, cliente) entra solo a la clasificación del día. Si algo queda sin clasificar más de una semana, aparece como aviso.
- **Control al azar:** cada mes Jarvis muestra 10 clasificaciones hechas solo para que alguien diga "bien / mal". Si falla mucho, se revisa cómo clasifica.
- Toda corrección humana queda anotada con quién y cuándo, y **manda sobre la IA**: si alguien dijo "esto no es plástico", Jarvis no lo vuelve a cambiar.

### 10.3 Lo que definen ustedes (políticas, no datos)
Son pocas y Jarvis propone el número inicial mirando el historial:
- **Deuda:** a partir de cuántos días o cuánta plata vencida propone retener entregas. ¿Hay clientes intocables o que solo se tocan con OK de alguien en particular?
- **Stock:** cuántos días de stock queremos tener como mínimo (general o por rubro).
- **Margen:** por debajo de qué margen avisa.
- **Compra anticipada:** cuánto aumento esperado justifica adelantar una compra y hasta cuánta plata.
- **Avisos:** qué tanto molestar (solo urgentes / todo).

Se cargan en la pantalla de **"Reglas de Jarvis"**: cada regla dice quién la cargó y cuándo. Se pueden cambiar en cualquier momento. Cambiarlas no requiere programar.

## 11. Cómo es el cerebro por dentro (sin tecnicismos)
- **El modelo** (Opus hoy) es el que **piensa y redacta**. No guarda nada y no sabe nada de la empresa por sí solo.
- **Las herramientas** son las "ventanillas" por donde Jarvis pide datos al sistema: "dame la deuda por antigüedad de esta zona". Cada ventanilla es una consulta fija y probada. Jarvis no puede inventar consultas ni tocar la base de otra forma. **Esto es lo que garantiza que no rompe nada.**
- **La memoria** son tablas del sistema: conversaciones, agenda, decisiones, reglas, clasificaciones e indicadores de afuera. El modelo se puede cambiar mañana por otro y **la memoria queda**, porque es nuestra, no del modelo.
- **El reloj** es un proceso que se despierta solo (todas las mañanas, cada semana) y corre los vigías, la clasificación de lo nuevo y la búsqueda de precios afuera.
- **Los botones de decisión** son lo único que cambia algo. Pasan por las mismas funciones del sistema que usa una persona y anotan quién apretó.

## 12. Lo que tenía que decidir Juan (respondido en §9)
1. **Cambio de regla.** El pedido original decía "Jarvis solo lee". Con lo que pediste pasa a ser: *"Jarvis lee y propone; una persona confirma; el sistema ejecuta; todo queda anotado"*. ¿OK?
2. **Quién confirma.** ¿Solo admin, o también administrativo? ¿Depende del tipo de decisión? Por ejemplo, retener entregas y órdenes de compra solo admin, y recordatorios cualquiera.
3. **Quién usa Jarvis.** Propuesta: admin y administrativo. ¿Más adelante vendedores, con una versión que solo vea sus clientes?
4. **Internet.** ¿Le damos permiso para buscar petróleo, dólar y noticias?
5. **Tope de gasto mensual** en dólares.
6. **Limpieza:** borrar los 235 avisos viejos del lector de mails (spam de marzo y abril) de la agenda.
7. **Pantallas nuevas** (botones de decisión, agenda, registro). La sesión de diseño ya terminó Playroom. ¿Las hago yo con el mismo estilo o se las pasamos a esa sesión?
