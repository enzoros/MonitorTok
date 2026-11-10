# Especificación Técnica: MonitorTok (Antigravity & `agy` Token & Cost Monitor)

Aplicación de escritorio ultraligera para **Linux** construida con **Tauri v2 (Rust + React/TypeScript + Tailwind CSS)** para auditar, visualizar y calcular en tiempo real el consumo de tokens (Input, Cache Read, Output y Razonamiento/Thinking) y el retorno de inversión (ROI) de la suscripción de **Google Antigravity** y su herramienta de línea de comandos **`agy` (Antigravity CLI)**.

---

## 1. Hallazgo Crítico y Arquitectura Multi-Origen

### 1.1. Descubrimiento: dos raíces, un solo universo de conversaciones
Antigravity usa dos raíces con la misma estructura:
* **IDE / Desktop App:** `~/.gemini/antigravity/`
* **CLI (`agy`):** `~/.gemini/antigravity-cli/`

Verificado en el sistema (2026-11-09):
* `conversation_summaries.db` del IDE ya indexa **todas** las conversaciones, incluidas las del CLI (189 en total; las 111 del CLI también están ahí; CLI-only = 0). El campo `source` (`CORTEX_TRAJECTORY_SOURCE_CLI`) distingue el origen.
* Los **`.db` con los tokens (`gen_metadata`)** están repartidos: el IDE tiene 179 y el CLI 13; solo 1 UUID coincide. Por eso hay que leer **ambas raíces** o se pierde el consumo de `agy` (ej. una sesión CLI con 346 llamadas al modelo vive solo en `antigravity-cli/conversations/`).
* **Deduplicar siempre por UUID.** El origen (`IDE`/`CLI`) se toma de `source`, no de la carpeta donde está el `.db`.

### 1.2. Arquitectura de Ingestión Unificada (Multi-Root)
Ambos directorios comparten exactamente la misma estructura de almacenamiento. MonitorTok implementa un motor de ingestión que vigila y consolida ambas rutas de forma transparente:

```
[Antigravity IDE]                 [Terminal: agy CLI]
       │                                  │
       ▼                                  ▼
~/.gemini/antigravity/           ~/.gemini/antigravity-cli/
 ├── conversation_summaries.db    ├── conversation_summaries.db
 ├── conversations/*.db           ├── conversations/*.db
 └── brain/*/transcript.jsonl     └── brain/*/transcript.jsonl
       │                                  │
       └────────────────┬─────────────────┘
                        │
                        ▼ (notify file watcher: inotify en Linux)
            [Backend Rust - Tauri v2]
              ├─ Lector conversation_summaries.db (Metadatos: títulos, workspaces, subagentes)
              ├─ Lector conversations/*.db (mode=ro, WAL)
              ├─ Decodificador gen_metadata (Varints/Protobuf) + Fallback transcript.jsonl
              └─ Base de Datos Local Agregada (`app_metrics.sqlite`)
                        │
                        ▼ (Eventos IPC Tauri: metrics://updated)
            [Frontend React 19 + TypeScript + Tailwind]
              ├─ Dashboard ROI & Eficiencia de Caché
              ├─ Vista de Proyectos (Filtro All / IDE / CLI)
              ├─ Auditoría de Sesiones y Semáforo de Context Bloat
              └─ Widget de Bandeja del Sistema (Linux System Tray)
```

---

## 2. Ingestión de Datos y Mitigación de Bloqueos

### 2.1. Metadatos Rápidos vía `conversation_summaries.db`
En lugar de abrir cientos de bases de datos individuales y decodificar blobs binarios para averiguar qué proyecto pertenece a cada conversación, el backend lee directamente la tabla `conversation_summaries`:
* `conversation_id`: UUID de la sesión.
* `title`: Título legible de la conversación generado por Antigravity.
* `workspace_uris`: Array JSON con la ruta del proyecto (ej. `["file:///home/enzo/OrbitDesign"]`).
* `source`: Canal de origen (`CORTEX_TRAJECTORY_SOURCE_CLI` o vacío para IDE).
* `parent_conversation_id`: Identificador de la conversación padre si se trata de un subagente.
* `last_modified_time`: Timestamp ISO 8601.

### 2.2. Agrupación Unificada de Subagentes
Los subagentes (ej. agentes de `research` o llamadas anidadas) **no se separan en pestañas independientes**. El motor agrega automáticamente el consumo de tokens y costos de las conversaciones hijas a la conversación padre a la que pertenecen, permitiendo desplegarlas opcionalmente como subtareas dentro del inspector de turnos.

### 2.3. Lectura segura de SQLite en modo WAL
Antigravity y `agy` usan WAL (`.db-wal` / `.db-shm`).
* **NO usar `immutable=1`:** SQLite ignora el WAL y los turnos recientes no aparecen. Verificado: en una conversación activa `immutable=1` veía 50 filas y `mode=ro` 51 (WAL de 7 MB).
* **Usar:** `file:<ruta>?mode=ro` (lee el WAL sin escribir en la base) con `busy_timeout` de 1000 ms.
  ```rust
  let uri = format!("file:{}?mode=ro", db_path.display());
  let conn = Connection::open_with_flags(&uri,
      OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_READ_ONLY)?;
  conn.busy_timeout(Duration::from_millis(1000))?;
  ```
* **Nunca** abrir un `.db` que no exista (`sqlite3.connect`/`Connection::open` sin `READ_ONLY` crea un archivo vacío). Comprobar existencia y tamaño > 0 antes.
* Si hay `SQLITE_BUSY`/`SQLITE_CORRUPT`, reintentar en el siguiente ciclo; fallback: copiar `.db` + `-wal` + `-shm` a un temporal y leer la copia.

### 2.4. Extracción de Tokens y Modelo
**Estado de verificación del protobuf (`gen_metadata.data`):**
| Dato | Estado |
|---|---|
| `input_tokens` / `output_tokens` | Probable: submensaje anidado `1 → 4`, campos 2 y 3 (coinciden con `transcript.jsonl`: 10641 y 222). Confirmar en más filas. |
| Modelo | Aparece como string (`gemini-3.8-flash-n`) y nombre legible (`Gemini 3.8 Flash (Medium)`); además `model_enum` (`MODEL_PLACEHOLDER_M319`). |
| `cache_read_tokens` | **Sin identificar** en el blob. Disponible en `transcript.jsonl`. |
| `thinking_tokens` | **Sin identificar**; `transcript.jsonl` tampoco lo trae. Columna opcional hasta confirmarlo. |

**Estrategia:**
1. **Fuente de verdad provisional:** `brain/<uuid>/.system_generated/logs/transcript.jsonl` (eventos `PLANNER_RESPONSE` con `input_tokens`, `cache_read_tokens`, `output_tokens`). Solo existe para parte de las conversaciones (159 transcripts vs 189 conversaciones).
2. **Fuente rápida:** `gen_metadata` en `.db`, una vez completado el spike de ingeniería inversa (Fase 0), validando contra el transcript.
3. Si el parser encuentra campos desconocidos o valores incoherentes, marcar la conversación como `parse_status = 'partial'` y avisar en la UI en vez de mostrar ceros.

---

## 3. Esquema de Base de Datos Local (`app_metrics.sqlite`)

Ubicada en `~/.local/share/monitortok/app_metrics.sqlite` (o `$XDG_DATA_HOME/monitortok/`):

```sql
-- 1. Conversaciones consolidadas (IDE + CLI)
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,                  -- UUID
    parent_id TEXT,                       -- UUID de la conversación padre si es subagente
    origin TEXT NOT NULL,                 -- 'IDE' | 'CLI' (desde `source`, no desde la carpeta)
    db_root TEXT,                         -- Raíz donde vive el .db con los tokens
    parse_status TEXT DEFAULT 'ok',       -- 'ok' | 'partial' | 'no_data'
    title TEXT NOT NULL,                  -- Título del chat
    workspace_path TEXT,                  -- Ej: /home/enzo/OrbitDesign
    project_alias TEXT,                   -- Alias editable por el usuario
    first_seen_at INTEGER NOT NULL,       -- Unix timestamp
    last_updated_at INTEGER NOT NULL,     -- Unix timestamp
    last_processed_idx INTEGER DEFAULT 0, -- Último idx leído en gen_metadata
    total_turns INTEGER DEFAULT 0,
    max_context_tokens INTEGER DEFAULT 0  -- Pico máximo de contexto (input + cache)
);

CREATE INDEX idx_conversations_workspace ON conversations(workspace_path);
CREATE INDEX idx_conversations_parent ON conversations(parent_id);

-- 2. Registro detallado de turnos y llamadas a modelos
CREATE TABLE turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    turn_idx INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    model_name TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    thinking_tokens INTEGER,              -- NULL hasta identificar el campo
    cost_usd REAL DEFAULT 0.0,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id),
    UNIQUE(conversation_id, turn_idx)
);

CREATE INDEX idx_turns_conversation ON turns(conversation_id);
CREATE INDEX idx_turns_timestamp ON turns(timestamp);

-- 3. Tabla de Tarifas por Modelo (Editable por el usuario)
CREATE TABLE model_pricing (
    model_pattern TEXT PRIMARY KEY,       -- Ej: "gemini-3.8-flash", "claude-3-7-sonnet"
    display_name TEXT NOT NULL,           -- Ej: "Gemini 3.8 Flash", "Claude 3.7 Sonnet"
    input_per_1m REAL NOT NULL,           -- USD por 1M tokens de entrada
    cache_read_per_1m REAL NOT NULL,      -- USD por 1M tokens leídos de caché
    output_per_1m REAL NOT NULL           -- USD por 1M tokens de salida (incluye thinking)
);

-- 4. Puntos de control de sincronización
CREATE TABLE sync_checkpoints (
    source_root TEXT PRIMARY KEY,         -- Ruta vigilada (ej: ~/.gemini/antigravity)
    last_scan_timestamp INTEGER NOT NULL
);
```

---

## 4. Tarifas Predeterminadas y Fórmulas de Negocio

### 4.1. Tarifario Base (PLACEHOLDERS, no oficial)
> [!WARNING]
> Los precios de abajo son valores de referencia **no verificados**, editables por el usuario. Antigravity es una suscripción con cuotas, no cobra por API: el "valor equivalente" es una **estimación** y la UI debe indicarlo así.

Los modelos se emparejan por patrón contra el nombre real que aparece en los registros (ej. `gemini-3.8-flash-n`, `MODEL_PLACEHOLDER_M319`). Modelos sin regla usan el *Default* y se listan en Ajustes como "sin tarifa asignada".

| Patrón (ejemplo) | Input ($/1M) | Cache Read ($/1M) | Output ($/1M) |
|---|---|---|---|
| `gemini-*-flash*` | \$0.10 | \$0.025 | \$0.40 |
| `gemini-*-pro*` | \$1.25 | \$0.30 | \$5.00 |
| `claude-*-sonnet*` | \$3.00 | \$0.30 | \$15.00 |
| `claude-*-opus*` | \$15.00 | \$1.50 | \$75.00 |
| *Default* | \$1.00 | \$0.25 | \$4.00 |

> Los *thinking tokens*, cuando se identifiquen, se facturan al precio de output.

### 4.2. Fórmulas de Cálculo (estimaciones)

1. **Costo por Turno ($C_{\text{turno}}$):**
   $$C_{\text{turno}} = \left(\frac{T_{\text{in}}}{10^6} \cdot P_{\text{in}}\right) + \left(\frac{T_{\text{cache}}}{10^6} \cdot P_{\text{cache}}\right) + \left(\frac{T_{\text{out}}}{10^6} \cdot P_{\text{out}}\right)$$

2. **Ahorro Virtual por Caché ($S_{\text{cache}}$):**
   $$S_{\text{cache}} = \frac{T_{\text{cache}}}{10^6} \cdot (P_{\text{in}} - P_{\text{cache}})$$

3. **Tasa de Acierto de Caché (`Cache Hit Rate %`):**
   $$\text{Cache Hit Rate} = \left(\frac{T_{\text{cache}}}{T_{\text{cache}} + T_{\text{in}}}\right) \times 100$$

4. **Amortización de Suscripción (ROI):**
   $$\text{Ratio de Amortización} = \frac{\sum C_{\text{turno (Ciclo Actual)}}}{\text{Costo Mensual Suscripción (ej. \$20 USD)}}$$

---

## 5. Módulos de la Interfaz (Frontend React + Tailwind)

### Vista 1: Overview & ROI
* **Selector de Filtro de Origen:** `Todos` | `Solo IDE` | `Solo CLI (agy)`.
* **Filtros Temporales:** *Hoy*, *Últimas 24h*, *Semana actual*, *Ciclo de Facturación mensual*, *Histórico completo*.
* **Tarjeta de Amortización:** Termómetro visual de amortización (ej. *"Consumo equivalente: \$148.20 USD vs \$20 USD suscripción → 7.4x amortizado"*).
* **KPI Cards:**
  1. Total Tokens (Entrada + Caché vs Salida).
  2. Costo Equivalente API (\$ USD) y Ahorro por Caché (\$ USD).
  3. Cache Hit Rate Promedio (%).
  4. Sesiones y Turnos totales analizados.
* **Gráficas:**
  * Área apilada temporal de tokens (Input, Cache, Output).
  * Gráfica de dona con distribución de costos por modelo.

### Vista 2: Proyectos (Workspaces)
* Lista de proyectos detectados automáticamente (ej. `/home/enzo/OrbitDesign`, `/home/enzo/MonitorTok`).
* Desglose por proyecto:
  * Sesiones totales (desglosadas en IDE y `agy`).
  * Tokens acumulados y costo equivalente.
  * Modelo predominante.
  * Asignación de alias amigables.

### Vista 3: Auditoría y Live Monitor
* **Monitor en Vivo:** Destaca en la parte superior la sesión que esté escribiendo actualmente.
* **Semáforo de Context Bloat:**
  * 🟢 `< 60k tokens`: Contexto ágil y óptimo.
  * 🟡 `60k - 120k tokens`: Contexto medio.
  * 🔴 `> 120k tokens`: Alerta de saturación (aviso para iniciar nuevo chat y ahorrar cuota).
* **Inspector de Sesión (Drawer / Detalle):**
  * Historial turno por turno (gráfico de barras por turno).
  * Desglose de subagentes integrados como ramas de la conversación principal.

### Vista 4: Ajustes y Tarifario
* Edición de precios por modelo y adición de nuevos modelos con expresiones regulares.
* Configuración del ciclo de facturación (día de corte mensual y precio de la suscripción).
* Lista de carpetas vigiladas (`~/.gemini/antigravity` y `~/.gemini/antigravity-cli` preconfiguradas).
* Botón de re-escaneo forzado y exportación a JSON/CSV.

### Extra: Linux System Tray
* Ícono en la bandeja del sistema (vía `libayatana-appindicator` / Tauri System Tray).
* Tooltip y menú contextual rápido con el contexto activo, tokens del día y costo acumulado sin abrir la ventana principal.

---

## 6. Robustez, Privacidad y Pruebas

* **Ciclo de vida:** conversaciones borradas/archivadas, `.db` truncados o sin `gen_metadata`, summaries sin `.db` (ocurre en el sistema) → se registran con `parse_status = 'no_data'` sin romper el sync.
* **Cambios de esquema:** si Antigravity cambia el protobuf (campos desconocidos, tokens incoherentes), mostrar aviso de "formato no reconocido" en lugar de números en cero.
* **Privacidad:** `title`, `workspace_uris` y rutas son datos sensibles. La exportación CSV/JSON ofrece opción de anonimizar. Nada sale del equipo (sin telemetría ni red).
* **Pruebas:** fixtures con copias anonimizadas de `.db` reales y su `transcript.jsonl` para tests del parser; test de lectura concurrente con WAL activo.
