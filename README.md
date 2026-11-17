# Gráficos familia (fase 1)

Aplicación web privada de gráficos de trading, para uso familiar. Sustituye las funciones de TradingView que usamos de verdad, con datos gratuitos.

**Fase 1 (esta versión):** cripto de Binance, cuadrícula de 6 gráficos, indicadores, watchlist y líneas horizontales guardadas.

---

## Cómo ponerla en marcha en Windows (paso a paso)

Sólo hace falta hacerlo una vez.

1. **Instala Node.js.** Entra en <https://nodejs.org>, pulsa el botón verde **LTS** (versión 22 o superior), descarga el instalador y dale a *Siguiente* hasta terminar con las opciones por defecto.
2. **Descarga la aplicación.** En la página del repositorio de GitHub, pulsa el botón verde **Code → Download ZIP**.
3. **Descomprime el ZIP** en una carpeta fija, por ejemplo `C:\Graficos` (botón derecho → *Extraer todo…*).
4. **Abre la carpeta y haz doble clic en `iniciar.bat`.**
   - Se abre una ventana negra con el mensaje *"✔ Gráficos en marcha"* y el navegador se abre solo en <http://localhost:3000>.
   - Si Windows avisa con *"Windows protegió su PC"*, pulsa *Más información → Ejecutar de todas formas* (es nuestro archivo).
   - Si el cortafuegos pregunta, puedes darle a *Cancelar*: la app sólo escucha en este ordenador.
5. **Para cerrarla**, cierra la ventana negra. Para volver a usarla, doble clic otra vez en `iniciar.bat`.

No hace falta instalar nada más: la aplicación ya va compilada (carpeta `dist`) y el servidor no usa paquetes externos.

### Probar sin conexión a Binance

Abre <http://localhost:3000/?demo=1>. Usa precios inventados para poder probar la interfaz sin internet.

---

## Cómo se usa

| Qué | Cómo |
|---|---|
| Cambiar de símbolo | Clic en la watchlist de la izquierda. Cambian los 6 gráficos a la vez. |
| Añadir un símbolo | Escribe el par (p. ej. `ETHUSDT`) abajo en la watchlist y pulsa **+**. Para quitarlo, pasa el ratón por encima y pulsa ✕. |
| Cuadrícula / gráfico grande | Botones **6 gráficos** y **Uno grande** arriba. También: doble clic en la cabecera de un gráfico o botón ⤢. |
| Cambiar la temporalidad de un gráfico | Desplegable junto al símbolo en cada gráfico (45s, 1m, 2m, 5m, 10m, 15m, 30m, 1h, 3h, 4h, D, S, M). |
| Mostrar/ocultar indicadores | Botones de la cabecera de cada gráfico: E18, E20, E50, S200, MTF, RSI, Vol, Piv. |
| Configurar medias y medias de otra temporalidad | Botón ⚙ de cada gráfico. Ahí cambias periodo, tipo (EMA/SMA), color, grosor, y añades medias tipo "EMA 50 de 15m". |
| Línea horizontal | Botón **Línea horizontal** (o **Alt+H**) y clic en el gráfico. Aparece en los 6 gráficos del mismo símbolo. |
| Mover una línea | Arrástrala con el ratón (el cursor cambia a ↕ encima de la línea). |
| Color, grosor, precio exacto o borrar | Haz clic en la línea: arriba aparece la barra de edición. **Supr** la borra, **Esc** la deselecciona. |
| Más historia | Desplaza el gráfico hacia la izquierda: carga velas antiguas automáticamente. |

Las líneas, la watchlist y la configuración de los gráficos se guardan en el servidor (archivo `datos\graficos.db`). **Copia esa carpeta `datos` si quieres hacer una copia de seguridad.**

El punto de color de arriba a la derecha indica la conexión en tiempo real con Binance: verde = conectado, amarillo = conectando, rojo = sin conexión (reintenta solo).

---

## Qué incluye la fase 1

- Cuadrícula de 6 gráficos del mismo símbolo: **1D, 4h, 1h, 15m, 5m y 45s**, con cruz sincronizada (mismo precio y misma hora en todos).
- Vista de un solo gráfico grande.
- Temporalidades que Binance no da se construyen agregando velas menores: **45s** (de velas de 1s), **2m** (de 1m), **10m** (de 5m), **3h** (de 1h).
- Indicadores: **EMA 18, EMA 20, EMA 50, SMA 200**, medias **multi-temporalidad** (MTF, dibujadas escalonadas), **RSI 14 con su media de 14**, **volumen** y **Pivots Traditional** automáticos (como en TradingView: diarios hasta 15m, semanales hasta 4h, mensuales en diario, anuales en S/M).
- Watchlist cripto con último precio, cambio y % del día (desde la apertura de las 00:00 UTC, como TradingView en cripto).
- Líneas horizontales de colores por símbolo, con precio en el eje, guardadas en el servidor.
- Horas en la zona horaria de tu ordenador (España).

Las fórmulas de EMA, SMA, RSI y pivots son las mismas que usa TradingView, así que los valores deben coincidir (puede haber diferencias mínimas en las primeras velas cargadas).

### Limitaciones conocidas de esta fase

- El gráfico de **45s** sale de velas de 1 segundo; al abrirlo carga unas 5 horas de historia (más si te desplazas a la izquierda).
- Todavía **no hay usuario y contraseña**: por eso el servidor sólo acepta conexiones desde el mismo ordenador. El acceso desde el móvil y para toda la familia llega en la fase 5.
- Las alertas por Telegram llegan en la fase 2; Fibonacci, caja de posición y líneas de tendencia en la fase 3; oro, plata y acciones en la fase 4.

---

## Para quien toque el código

```
src/
  providers/      Capa de proveedores de datos (intercambiable)
    provider.ts     La interfaz que cumple cada proveedor
    binance.ts      Binance: REST (vía nuestro servidor) + WebSocket
    mock.ts         Datos inventados (?demo=1)
    index.ts        Elige el proveedor
  core/
    timeframes.ts   Temporalidades, agregación de velas
    store.ts        Caché de velas por símbolo+temporalidad, tiempo real, reconexión
    drawings.ts     Líneas horizontales (sincronizadas con el servidor)
  indicators/     EMA, SMA, RSI, proyección multi-temporalidad, pivots
  chart/          Panel de gráfico, pivots (primitiva propia), cruz sincronizada
  ui/             Watchlist, ajustes, valores por defecto
server/server.mjs Servidor Node sin dependencias (SQLite incluido en Node ≥ 22.13)
dist/             Aplicación compilada (lo que sirve el servidor)
```

Comandos (requieren `npm install` la primera vez):

- `npm run dev` → modo desarrollo con recarga automática en <http://localhost:5173> (arranca también `npm start` en otra ventana).
- `npm run build` → comprueba tipos y vuelve a generar `dist/`.
- `npm start` → arranca el servidor.

Para añadir un proveedor nuevo (OANDA, Alpaca, Finnhub…): crear una clase en `src/providers/` que cumpla `DataProvider` y elegirla en `providers/index.ts`. Sólo tiene que dar sus temporalidades nativas; el resto se construye solo.

Variables de entorno del servidor: `PORT` (3000), `HOST` (127.0.0.1), `DATA_DIR` (`datos`), `OPEN_BROWSER`. Las claves de API de fases futuras irán también en variables de entorno, nunca en el código.

Gráficos hechos con [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/) (licencia Apache 2.0). Se mantiene el logotipo/enlace de atribución en cada gráfico.
