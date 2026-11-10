# MonitorTok: Antigravity & `agy` Token & Cost Monitor

Aplicación de escritorio ultraligera para **Linux** construida con **Tauri v2 (Rust + React 19 + TypeScript + Tailwind CSS)** para auditar, visualizar y calcular en tiempo real el consumo de tokens y el retorno de inversión (ROI) de la suscripción de **Google Antigravity** y la herramienta CLI **`agy`**.

![Linux Desktop](https://img.shields.io/badge/Platform-Linux%20(x86__64)-blue.svg)
![Tauri v2](https://img.shields.io/badge/Tauri-v2.0-indigo.svg)
![React 19](https://img.shields.io/badge/React-19-cyan.svg)
![Rust](https://img.shields.io/badge/Rust-2024%20(1.99+)-orange.svg)
![License](https://img.shields.io/badge/License-MIT-emerald.svg)

---

## 🌟 Características Principales

1. **Enfoque Zero-Touch / Read-Only Inviolable:**
   * No intercepta la red ni modifica ningún archivo de configuración de Antigravity.
   * Abre las bases de datos de sesión en modo estricto de solo lectura compatible con SQLite WAL (`file:<ruta>?mode=ro`).
   * No crea archivos huérfanos ni compite por bloqueos de escritura con el agente.

2. **Ingestión Multi-Origen Unificada (IDE + CLI `agy`):**
   * Detecta y consolida automáticamente las sesiones del entorno gráfico (`~/.gemini/antigravity`) y de la terminal (`~/.gemini/antigravity-cli`).
   * Deduplica por UUID y preserva el canal de origen para cada conversación.

3. **Dashboard de Retorno de Inversión (ROI):**
   * Termómetro visual de amortización comparando el costo fijo mensual pagado (ej. \$20 USD/mes) frente al valor API equivalente generado.
   * 4 Tarjetas KPI: Tokens Totales (In, Cache, Out), Costo Estimado API, Eficiencia de Caché (% Hit Rate) y Actividad Auditada.
   * Gráfica de área apilada temporal de consumo de tokens y gráfica de dona de costo por modelo (Gemini Flash, Pro, Argon, Claude Sonnet, Opus, Haiku).

4. **Auditoría & Semáforo de Inflación de Contexto (*Context Bloat*):**
   * 🟢 `< 60k tokens`: Contexto ligero, ágil y óptimo.
   * 🟡 `60k - 120k tokens`: Contexto medio.
   * 🔴 `> 120k tokens`: Alerta de saturación (aviso para iniciar un nuevo chat y ahorrar cuota).
   * **Drawer Lateral / Inspector Turno por Turno:** Gráfico de barras de evolución del contexto y detalle paso a paso de cada llamada al modelo con costos y tokens.

5. **Consolidación por Proyectos (Workspaces):**
   * Agrupación automática por repositorio o carpeta de trabajo (ej. `OrbitDesign`, `MonitorTok`).
   * Desglose de llamadas generadas desde el IDE versus la terminal con `agy`.

6. **System Tray Nativo en Linux:**
   * Ícono persistente en la bandeja del sistema (vía `libayatana-appindicator`).
   * Acceso rápido para abrir el Dashboard o salir con un clic.

7. **Exportación & Privacidad:**
   * Exportación instantánea a **CSV** y **JSON**.
   * Modo de **Anonimizado de Datos**: oculta nombres reales de carpetas y títulos de sesiones para auditorías públicas o reportes de clientes.

---

## 📦 Instalación y Paquetes (.deb)

Puedes compilar el paquete de instalación para Debian/Ubuntu o descargar los binarios precompilados desde la sección de **Releases** en GitHub:

* **Compilar e instalar paquete Debian / Ubuntu (`.deb`):**
  ```bash
  pnpm tauri build
  sudo dpkg -i src-tauri/target/release/bundle/deb/MonitorTok_0.1.0_amd64.deb
  ```


---

## 🛠️ Desarrollo Local

### Requisitos del Sistema (Linux)
* Node.js v20+ y `pnpm`
* Rust y Cargo 1.90+
* Librerías del sistema: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`

```bash
# 1. Instalar dependencias del frontend
pnpm install

# 2. Iniciar en modo desarrollo con recarga rápida (HMR + Rust)
pnpm tauri dev

# 3. Ejecutar los tests unitarios y de integración del backend
cd src-tauri && cargo test -- --nocapture

# 4. Compilar binarios de producción
pnpm tauri build
```

---

## 🏗️ Arquitectura Técnica

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
                        ▼ (notify file watcher: inotify con debounce de 400ms)
            [Backend Rust - Tauri v2]
              ├─ Lector conversation_summaries.db (Metadatos: títulos, workspaces, subagentes)
              ├─ Lector conversations/*.db (file:<path>?mode=ro)
              ├─ Decodificador gen_metadata (Varints/Protobuf)
              ├─ Extractor Rayon multi-hilo en paralelo
              └─ Base de Datos Local Agregada (`~/.local/share/monitortok/app_metrics.sqlite`)
                        │
                        ▼ (Eventos IPC reactivos: metrics://updated)
            [Frontend React 19 + TypeScript + Tailwind CSS]
              ├─ Zustand Store reactivo
              ├─ Dashboard ROI & Eficiencia de Caché (Recharts)
              ├─ Vista de Proyectos & Auditoría de Sesiones
              └─ Widget de Bandeja del Sistema (Linux System Tray)
```
