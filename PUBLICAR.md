# Cómo se publica una versión nueva

Desde la v0.3.3 el programa de escritorio se **actualiza solo** desde GitHub Releases
(`electron-updater`, código en `electron/updater.mjs`). Para que la familia reciba un cambio:

1. **Parte de la rama más reciente** (la que publicó la última versión: mira la release
   más reciente en <https://github.com/VodafoneElche/Graficos-caseros/releases>, sus notas
   dicen la rama y el commit). Si partes de una rama antigua, quitarías funciones.
2. Haz los cambios. Si tocas `src/`, ejecuta `npm run build` y commitea también `dist/`.
3. **Sube la versión** en `package.json` (y `package-lock.json`):
   `npm version patch --no-git-tag-version` (0.3.3 → 0.3.4). Sin esto **no se publica nada**.
4. Escribe el mensaje del commit en español y para Jose (`v0.3.4: qué cambia`): la primera
   línea y el texto del último commit son las **notas de la versión** que se ven en GitHub.
5. `git push` a la rama. Valen `main`, `fase-1-prototipo` y cualquier rama `claude/**`.

Lo demás lo hace GitHub Actions (`.github/workflows/instalador-windows.yml`):

- Un paso rápido en Linux compara la versión de `package.json` con la última publicada.
  Solo sigue si es **mayor** (si no, deja un aviso en la ejecución y termina).
- En un Windows de GitHub compila, crea el instalador y publica la release
  **`v<versión>`** marcada como *Latest* con `Graficos-familia-Setup.exe`,
  `Graficos-familia-Setup.exe.blockmap` y `latest.yml`.
- Copia el instalador también en la release `ultima-version` (enlace antiguo; no es *Latest*).

En unas horas como mucho (o al abrir el programa, o al pulsar en el número de versión)
cada ordenador de la familia lo descarga y muestra **Reiniciar y actualizar**.

## Enlaces

- Instalar de cero (siempre la última): <https://github.com/VodafoneElche/Graficos-caseros/releases/latest/download/Graficos-familia-Setup.exe>
- Todas las versiones: <https://github.com/VodafoneElche/Graficos-caseros/releases>

## Cosas a tener en cuenta

- **No borres ni edites a mano** las releases `v…`: el programa lee `latest.yml` de la
  release marcada como *Latest*. No marques `ultima-version` como *Latest*.
- Versiones de prueba sin repartir a la familia: no subas la versión (no se publica), o
  lanza el flujo a mano (*Actions → Instalador Windows → Run workflow*): también publica
  solo si la versión es mayor.
- Volver atrás: publica una versión **mayor** con el código anterior (por ejemplo 0.3.5
  con lo de la 0.3.3). El programa nunca baja de versión.
- El instalador no está firmado: la primera instalación a mano pide
  *Más información → Ejecutar de todas formas*; las actualizaciones automáticas no.
- Para probar el actualizador sin GitHub: variable de entorno `GRAFICOS_UPDATE_URL`
  apuntando a una carpeta servida por HTTP con `latest.yml` (proveedor *generic*).
