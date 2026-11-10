# Guía para Agentes de IA: MonitorTok

Este documento establece las reglas, principios de diseño, convenciones técnicas y restricciones críticas que cualquier agente o desarrollador debe seguir al implementar o modificar el código de **MonitorTok**.

---

## 1. Principio Fundamental: Zero-Touch & Read-Only Inviolable

> **REGLA DE ORO:** MonitorTok **JAMÁS** debe modificar, bloquear o alterar los archivos, directorios o bases de datos de Google Antigravity ni de `agy` CLI.

1. **Lectura Solo-Lectura de SQLite (WAL):**  
   Al abrir cualquier `.db` dentro de `~/.gemini/antigravity/` o `~/.gemini/antigravity-cli/`, usar **obligatoriamente**:
   ```rust
   let uri = format!("file:{}?mode=ro", path.display());
   // OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_READ_ONLY + busy_timeout(1000)
   ```
   * **PROHIBIDO `immutable=1`:** ignora el WAL y los datos recientes no se ven (verificado).
   * **PROHIBIDO abrir rutas sin comprobar que existen y pesan > 0 bytes:** abrir un `.db` inexistente crea un archivo vacío en la carpeta de Antigravity. Esto ya ocurrió una vez durante el análisis del proyecto.
   * No abrir conexiones de escritura en esas rutas bajo ninguna circunstancia.
2. **Escritura Exclusiva en Datos de la Aplicación:**  
   Toda persistencia de MonitorTok debe ocurrir en su propia base de datos local `app_metrics.sqlite` (en `$XDG_DATA_HOME/monitortok/` o `~/.local/share/monitortok/`).
3. **Manejo Tolerante de Errores:**  
   Si una base de datos o archivo de Antigravity está en proceso de creación, corrupto o incompleto, la operación debe fallar silenciosamente con un log de advertencia y reintentar en el siguiente ciclo del watcher sin detener la aplicación.
4. **Aprobación Explícita y Exclusividad de `.deb` para Compilar:**  
   Los agentes **NUNCA** deben ejecutar `pnpm tauri build` por iniciativa propia sin previa autorización expresa del usuario. Además, por política del proyecto, **solo se genera el paquete `.deb`** (está configurado `"targets": ["deb"]` en `tauri.conf.json`). Queda deshabilitada la generación de `.AppImage` y `.rpm` para evitar sobrecostes de tiempo y CPU causados por `linuxdeploy` y SquashFS. Los cambios de código deben verificarse exclusivamente con `pnpm build` (frontend) o `cargo test` / `cargo check` (backend) salvo que el usuario pida explícitamente compilar el paquete `.deb`.

---

## 2. Soporte Obligatorio Multi-Origen (IDE + CLI)

Cualquier funcionalidad que lea datos de Antigravity debe consultar **ambas fuentes**:
* **Fuente IDE:** `~/.gemini/antigravity`
* **Fuente CLI (`agy`):** `~/.gemini/antigravity-cli`

Ambas raíces poseen la misma estructura:
* **Deduplicar por UUID:** `conversation_summaries.db` del IDE ya incluye las conversaciones del CLI (`source = CORTEX_TRAJECTORY_SOURCE_CLI`), pero algunos `.db` con tokens solo existen en `antigravity-cli/conversations/`. El origen sale de `source`, no de la carpeta.
* `conversation_summaries.db`: Fuente primaria para títulos, workspaces (`workspace_uris`), timestamps y subagentes (`parent_conversation_id`).
* `conversations/<uuid>.db`: tabla `gen_metadata` (protobuf). Solo `input`/`output` están parcialmente mapeados; `cache_read` y `thinking` **no están confirmados**.
* `brain/<uuid>/.system_generated/logs/transcript.jsonl`: fuente de verdad provisional para tokens hasta completar el spike del parser. No existe para todas las conversaciones.
* Nunca inventes números: si el parser falla, marca `parse_status = 'partial'` en vez de guardar ceros.

## 2.1. Precios
Los precios del tarifario son placeholders editables, no oficiales. Presenta siempre los costos como "equivalente estimado" (Antigravity es suscripción, no API).

---

## 3. Jerarquía de Conversaciones y Subagentes

* Los subagentes tienen un valor no nulo en `parent_conversation_id` dentro de `conversation_summaries.db`.
* **Regla de UX:** Los tokens y costos de los subagentes se consolidan y suman **directamente dentro de la conversación padre**.
* No crear pestañas separadas para subagentes; se visualizan como desgloses jerárquicos dentro del inspector de la sesión padre.

---

## 4. Stack y Convenciones de Código

### 4.1. Backend (Rust - `src-tauri/`)
* **Edición:** Rust 2021+.
* **Tauri:** v2 (`tauri = "2"`, `tauri-plugin-shell`, `tauri-plugin-fs`).
* **Base de datos:** `rusqlite` con feature `bundled`.
* **File Watcher:** `notify` con un debounce mínimo de 300-500 ms para evitar saturar el hilo ante escrituras continuas de tokens.
* **Manejo de Errores:** Usa `thiserror` para tipos de error internos y mapea a strings legibles para las respuestas de comandos IPC hacia el frontend.
* **Comandos IPC:** Mantén los comandos fuertemente tipados con `#[tauri::command]`.

### 4.2. Frontend (React + TypeScript - `src/`)
* **Framework:** React 19, TypeScript (modo estricto).
* **Estilos:** Tailwind CSS, diseño responsivo optimizado para Linux (soporte de tema oscuro por defecto).
* **Componentes e Iconos:** `lucide-react`.
* **Gráficas:** `recharts`.
* **Gestión de Estado:** `zustand` para el estado global (filtros temporales, selección de proyectos, configuración de precios).
* **IPC:** Llama a los comandos de Rust usando `@tauri-apps/api/core` (`invoke`).
* **Suscripción a Eventos:** Escucha eventos de actualización (`listen("metrics://updated", ...)`) para refrescar en vivo.

---

## 5. Comandos de Verificación y Desarrollo

```bash
# Entorno de desarrollo Tauri (ejecuta backend Rust y frontend Vite)
pnpm tauri dev

# Compilación y verificación estricta de Rust
cd src-tauri && cargo check && cargo clippy

# Tests unitarios del backend (lectura de SQLite, parser protobuf, cálculos de costo)
cd src-tauri && cargo test

# Verificación de tipos TypeScript y build del frontend
pnpm check-types && pnpm build

# Generación de paquete de producción para Linux (.deb / AppImage)
pnpm tauri build
```
