# Roadmap de Implementación: MonitorTok (Linux)

Roadmap interactivo para el desarrollo paso a paso de la aplicación **MonitorTok** en Linux (Tauri v2 + Rust + React/TypeScript).

---

## Fase 0: Setup y Spike de Ingeniería Inversa
> **Objetivo:** Validar lectura segura con WAL de ambas raíces y mapear los campos protobuf. **Criterio de salida:** los tokens decodificados de `gen_metadata` coinciden con `transcript.jsonl` en ≥ 20 conversaciones reales, o se decide usar `transcript.jsonl` como fuente.

- [x] **0.1. Inicialización del Workspace Tauri v2**
  - [x] Crear el proyecto con `pnpm create tauri-app@latest` (React + TypeScript).
  - [x] Configurar Tailwind CSS y `lucide-react`.
  - [x] Configurar `tauri.conf.json` con identificador único para Linux.
- [x] **0.2. Lectura segura multi-raíz en Rust**
  - [x] Detectar `~/.gemini/antigravity` y `~/.gemini/antigravity-cli` (comprobando existencia y tamaño > 0 antes de abrir).
  - [x] Abrir `.db` con `mode=ro` (sin `immutable`) y test de lectura concurrente con WAL activo.
  - [x] Leer `conversation_summaries.db`, deduplicar por UUID y derivar `origin` desde `source`.
  - [x] Verificar que no se crea ningún archivo en las carpetas de Antigravity al leer.
- [x] **0.3. Ingeniería inversa de `gen_metadata`**
  - [x] Confirmar `input`/`output` (submensaje `1 → 4`, campos 2 y 3) en muchas filas.
  - [x] Localizar `cache_read_tokens` y, si existe, `thinking_tokens`; si no existen, documentarlo.
  - [x] Extraer el nombre del modelo y mapear `model_enum`.
  - [x] Fixtures anonimizados + tests unitarios del parser.
  - [x] Fallback `transcript.jsonl` y marcado `parse_status`.

---

## Fase 1: Base de Datos Local Agregada y Motor de Sincronización
> **Objetivo:** Crear `app_metrics.sqlite` local y sincronizar el historial completo de conversaciones en milisegundos.

- [x] **1.1. Inicialización de `app_metrics.sqlite`**
  - [x] Crear migraciones de schema en Rust (`conversations` con `parse_status`/`db_root`, `turns`, `model_pricing`, `sync_checkpoints`).
  - [x] Insertar tarifario placeholder editable (marcado como no oficial) y manejo de modelos sin tarifa.
- [x] **1.2. Servicio de Sincronización Incremental (Sync Engine)**
  - [x] Sincronizar conversaciones desde `conversation_summaries.db` asociando subagentes a su conversación padre (`parent_conversation_id`).
  - [x] Escanear y sincronizar turnos incrementales desde el último `last_processed_idx` de cada `.db`.
  - [x] Calcular costos por turno según el modelo detectado y las tarifas activas.
  - [x] Benchmarking de sincronización completa del historial en Linux (< 500 ms objetivo).

---

## Fase 2: File Watcher y Eventos IPC Reactivos
> **Objetivo:** Monitorear en tiempo real las modificaciones en Antigravity y `agy` CLI y emitir eventos hacia el frontend.

- [x] **2.1. File Watcher Multi-Ruta con `notify`**
  - [x] Configurar observador de inotify sobre `~/.gemini/antigravity/conversations/` y `~/.gemini/antigravity-cli/conversations/`.
  - [x] Implementar debouncing de 400 ms por archivo modificado para procesar ráfagas de escritura.
- [x] **2.2. Pipeline de Eventos Tauri**
  - [x] Al detectar cambio, ejecutar sync incremental únicamente del archivo afectado.
  - [x] Emitir evento Tauri `metrics://turn-added` con los datos del nuevo turno y `metrics://session-updated`.
- [x] **2.3. Exposición de Comandos IPC**
  - [x] `get_dashboard_summary(filter: DateFilter, origin: OriginFilter)`
  - [x] `get_projects_summary()`
  - [x] `get_conversation_turns(conversation_id: String)`
  - [x] `update_model_pricing(pricing: Vec<ModelPrice>)`
  - [x] `trigger_rescan()`

---

## Fase 3: Frontend y Visualización de Métricas (React + Tailwind)
> **Objetivo:** Construir la interfaz de usuario en modo oscuro nativo, responsiva y con gráficas de alto rendimiento.

- [x] **3.1. Estado Global con Zustand**
  - [x] Store para filtros de fecha (Hoy, 24h, Semana, Mes de corte, Rango personalizado).
  - [x] Store para filtro de origen (`Todos`, `IDE`, `CLI`).
  - [x] Suscripción a eventos IPC de Tauri para actualización reactiva del estado.
- [x] **3.2. Vista Overview & Termómetro de ROI**
  - [x] Componente Termómetro de Amortización: consumo API acumulado vs costo suscripción ($20 USD).
  - [x] 4 Tarjetas KPI: Tokens Totales (Input, Cache, Output), Costo API ($ USD) y Ahorro por Caché ($ USD), Cache Hit Rate %, Total Sesiones/Turnos.
  - [x] Gráfica de área apilada temporal (Recharts) con capas de Input, Cache y Output.
  - [x] Gráfica de dona con distribución de costos por modelo.
- [x] **3.3. Vista de Proyectos (Workspaces)**
  - [x] Agrupación por directorio de proyecto (`workspace_path`).
  - [x] Desglose de consumo y costos por proyecto, indicando desglose IDE vs `agy` CLI.
  - [x] Edición y persistencia de alias amigables para cada workspace.
- [x] **3.4. Vista de Auditoría y Monitor en Vivo**
  - [x] Tarjeta de Sesión Activa (Live Session) con semáforo de Context Bloat (🟢 <60k, 🟡 60k-120k, 🔴 >120k tokens).
  - [x] Tabla histórica de conversaciones ordenable por fecha, tokens, costo y turnos.
  - [x] Drawer lateral con inspector turno por turno y árbol de subagentes anidados dentro de la sesión principal.
- [x] **3.5. Vista de Configuración y Tarifario**
  - [x] Tabla editable de tarifas por 1M de tokens por modelo.
  - [x] Selector de día de corte de facturación mensual (1 al 31) y costo mensual de suscripción.
  - [x] Indicador de estado de directorios vigilados (IDE y CLI) y botón de re-escaneo manual.

---

## Fase 4: System Tray en Linux, Exportación y Empaquetado
> **Objetivo:** Integración con la barra de tareas de Linux (AppIndicator) y generación de binarios de distribución.

- [x] **4.1. System Tray Nativo en Linux**
  - [x] Integrar `tauri::tray::TrayIconBuilder` con ícono svg/png temático.
  - [x] Menú contextual rápido:
    * `Abrir MonitorTok`
    * `Salir`
  - [x] Manejo de eventos de clic en el ícono de bandeja para restaurar ventana.
- [x] **4.2. Exportación de Datos**
  - [x] Exportación de métricas consolidadas y turnos a archivos CSV y JSON.
- [x] **4.3. Empaquetado y Verificación Final**
  - [x] Validar compatibilidad en entorno de escritorio Linux (GNOME/KDE/XFCE).
  - [x] Generar paquetes de distribución `.deb` y `.AppImage` usando `pnpm tauri build`.
  - [x] Documentar instrucciones de instalación y uso en `README.md`.
  - [x] Opción de anonimizar títulos/rutas al exportar (privacidad).
  - [x] Aviso en UI cuando el formato protobuf no se reconozca (`parse_status`).
