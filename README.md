# Gráficos familia (fase 1)

Aplicación web privada de gráficos de trading, para uso familiar. Sustituye las funciones de TradingView que usamos de verdad, con datos gratuitos.

**Fase 1 (esta versión):** cripto de Binance, cuadrícula de 6 gráficos, indicadores, watchlist y líneas horizontales guardadas.

---

## Instalar el programa en Windows (recomendado)

1. Descarga el instalador: <https://github.com/VodafoneElche/Graficos-caseros/releases/download/ultima-version/Graficos-familia-Setup-0.1.0.exe>
   (o entra en <https://github.com/VodafoneElche/Graficos-caseros/releases> y pulsa el `.exe`).
2. Haz doble clic en el archivo descargado. Si Windows avisa con *"Windows protegió su PC"*, pulsa *Más información → Ejecutar de todas formas* (el instalador no está firmado, es nuestro).
3. Sigue el asistente. Crea el acceso **Gráficos familia** en el escritorio y en el menú Inicio.
4. Ábrelo: sale una ventana propia, maximizada y sin barras de navegador. No hace falta Node.js ni nada más.

Atajos del programa: **F11** pantalla completa, **F5** recargar, **Ctrl + / Ctrl − / Ctrl 0** tamaño de letra.
Los datos (líneas, ajustes) se guardan en `%APPDATA%\Graficos familia\datos`.

Cada vez que se publica un cambio, GitHub genera un instalador nuevo en ese mismo enlace: basta con descargarlo e instalar encima.

## Alternativa: abrirla en el navegador

1. **Instala Node.js** (versión 22 o superior) desde <https://nodejs.org>.
2. **Descarga el ZIP** del repositorio (botón verde **Code → Download ZIP**) y descomprímelo en `C:\Graficos`.
3. **Doble clic en `iniciar.bat`**: se abre el navegador en <http://localhost:3000>. Para cerrarla, cierra la ventana negra.

### Probar sin conexión a Binance

Abre <http://localhost:3000/?demo=1>. Usa precios inventados para poder probar la interfaz sin internet.

---

## Cómo se usa

| Qué | Cómo |
|---|---|
| Cambiar de símbolo | Clic en la lista de seguimiento de la derecha. Cambian los 6 gráficos a la vez. Los símbolos en gris (oro, plata, acciones) tendrán datos en la fase 4. |
| Añadir un símbolo | Escribe el par (p. ej. `ETHUSDT`) abajo en la lista y pulsa **+**. Para quitarlo, pasa el ratón por encima y pulsa ✕. |
| Cuadrícula / gráfico grande | Botones **6 gráficos** y **Uno grande** arriba. También el botón ⤢ que aparece en la leyenda al pasar el ratón, o doble clic sobre las fechas de abajo. |
| Cambiar la temporalidad de un gráfico | Haz clic en el gráfico (queda con borde azul) y pulsa la temporalidad en la barra de arriba (45s, 1m, 2m, 5m, 10m, 15m, 30m, 1h, 3h, 4h, D, S, M). |
| Mostrar/ocultar indicadores | En la leyenda de arriba a la izquierda, con el ojo de cada indicador (como en TradingView). `⌄ 5` despliega la lista y `⌃` la recoge. |
| Configurar medias y medias de otra temporalidad | Botón ⚙ de la leyenda (o clic en el nombre del símbolo de la leyenda). Ahí cambias periodo, tipo (EMA/SMA), color, grosor, y añades medias tipo "EMA 50 de 15m". |
| Línea horizontal | Botón de línea horizontal en la barra de la izquierda (o **Alt+H**) y clic en el gráfico. Aparece en los 6 gráficos del mismo símbolo. |
| Mover una línea | Arrástrala con el ratón (el cursor cambia a ↕ encima de la línea). |
| Color, grosor, precio exacto o borrar | Haz clic en la línea: arriba aparece la barra de edición. **Supr** la borra, **Esc** la deselecciona. |
| Regla de medir | Botón de la regla en la barra de la izquierda: clic en el punto de inicio y clic en el final. También **Mayúsculas + arrastrar**. Muestra variación, %, ticks, barras, tiempo y volumen. **Esc** la quita. |
| Zoom | Lupas **−** y **+** abajo a la derecha de cada gráfico (o **Alt −** / **Alt +**), además de la rueda del ratón. |
| Encuadre automático | Botón **A** abajo a la derecha (o **Alt+A**). Se apaga si estiras la escala de precios a mano; púlsalo para volver a encuadrar. |
| Escala logarítmica | Botón **L** abajo a la derecha (o **Alt+L**). Se guarda por gráfico. |
| Más historia | Desplaza el gráfico hacia la izquierda: carga velas antiguas automáticamente. |

Las líneas, la watchlist y la configuración de los gráficos se guardan en el servidor (archivo `datos\graficos.db`). **Copia esa carpeta `datos` si quieres hacer una copia de seguridad.**

El punto de color de arriba a la derecha indica la conexión en tiempo real con Binance: verde = conectado, amarillo = conectando, rojo = sin conexión (reintenta solo).

---

## Aspecto

Copiado de la configuración de TradingView de Jose: fondo azul marino `#000d2e` sin cuadrícula, velas alcistas huecas blancas y bajistas grises `#4a4a4a`, EMA 20 blanca, EMA 50 roja, SMA 200 morada, medias de otra temporalidad naranjas, líneas horizontales amarillas, valores de los indicadores en el eje derecho y números en formato español (64.663,50). La configuración de Fibonacci y de la caja de posición ya está guardada en `src/core/toolDefaults.ts` para la fase 3.

## Qué incluye la fase 1

- Cuadrícula de 6 gráficos del mismo símbolo en 2 columnas x 3 filas (izquierda **1D, 4h, 1h**; derecha **15m, 5m, 45s**), con cruz sincronizada (mismo precio y misma hora en todos).
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
