# Gráficos familia

Aplicación web privada de gráficos de trading, para uso familiar. Sustituye las funciones de TradingView que usamos de verdad, con datos gratuitos.

**Fase 1:** cripto de Binance, cuadrícula de 6 gráficos, indicadores, watchlist y líneas horizontales guardadas.
**Fase 2 (esta versión):** alertas de precio (desde una línea horizontal) y de RSI, con aviso al móvil por Telegram.

---

## Instalar el programa en Windows (recomendado)

1. Descarga el instalador: <https://github.com/VodafoneElche/Graficos-caseros/releases/latest/download/Graficos-familia-Setup.exe>
   (o entra en <https://github.com/VodafoneElche/Graficos-caseros/releases> y pulsa el `.exe`).
2. Haz doble clic en el archivo descargado. Si Windows avisa con *"Windows protegió su PC"*, pulsa *Más información → Ejecutar de todas formas* (el instalador no está firmado, es nuestro).
3. Sigue el asistente. Crea el acceso **Gráficos familia** en el escritorio y en el menú Inicio.
4. Ábrelo: sale una ventana propia, maximizada y sin barras de navegador. No hace falta Node.js ni nada más.

Atajos del programa: **F11** pantalla completa, **F5** recargar, **Ctrl + / Ctrl − / Ctrl 0** tamaño de letra.
Los datos (líneas, ajustes) se guardan en `%APPDATA%\Graficos familia\datos`.

### Actualizaciones automáticas (desde la v0.3.3)

El programa se actualiza solo. Al abrirlo, y luego cada 2 horas, mira en GitHub si hay una versión nueva; si la hay, la descarga en segundo plano (arriba a la derecha se ve *⬇ Descargando…*). Cuando termina sale un aviso **Hay una versión nueva** con el botón **Reiniciar y actualizar**: el programa se cierra, se instala en unos segundos y se vuelve a abrir. Si pulsas *Más tarde*, se instala sola la próxima vez que cierres el programa. Las líneas, alertas y ajustes no se tocan.

Para buscar a mano, haz clic en el número de versión (arriba a la derecha).

Cómo se publica una versión nueva: ver [PUBLICAR.md](PUBLICAR.md).

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
| Buscar un símbolo | Clic en el nombre del símbolo (arriba a la izquierda) o empieza a escribir sobre el gráfico. Busca en todas las fuentes de datos (de momento Binance). |
| Configurar una media (EMA/SMA) | Doble clic en su nombre en la leyenda, o el ⚙ que aparece al pasar el ratón. Ventana como la de TradingView: longitud, fuente, compensación, suavizado, intervalo de tiempo (media de otra temporalidad, con "Espere al cierre"), color, grosor, estilo y visibilidad por temporalidades. |
| Añadir indicadores | Botón **Indicadores** de la barra superior (gráfico seleccionado): EMA, SMA, RSI, volumen, pivots y 2YMA. |
| Pivots | Doble clic en "Pivots" en la leyenda: tipo, temporalidad, número de pivotes, etiquetas, precios, grosor y qué niveles (P, S1-S5, R1-R5) con su color. |
| 2YMA | Media de 2 años (730 días) y esa media x 5, con fondos de zona barata/cara. Activada en el gráfico diario. |
| Línea vertical | Botón de línea vertical (o **Alt+V**) y clic. Se ve en todas las temporalidades. |
| Línea de tendencia (cuñas) | Botón de la raya inclinada (o **Alt+T**) y 2 clics, o pulsar y arrastrar. Se ve en los 6 gráficos. Arrastra un extremo para moverlo o la línea para moverla entera. Doble clic: color, grosor, estilo y **ampliar** a la izquierda/derecha. |
| Rectángulo | Botón del cuadrado y 2 clics (esquinas opuestas) o arrastrar. Fondo translúcido del mismo color. Se ajusta desde cualquiera de las 4 esquinas. |
| Trayectoria | Botón de la línea quebrada con flecha: un clic por punto y **doble clic** (o Intro / Esc) para terminar. |
| Nota con poste / Comentario | Botón de la "T" con palito o del bocadillo y un clic: se abre una ventana para escribir el texto (Intro = otra línea, Ctrl+Intro = aceptar). Doble clic en la nota para cambiar el texto o los colores. |
| Extensión de Fibonacci | Botón de Fibonacci y 3 clics: inicio, final y retroceso. Doble clic en ella para cambiar niveles y colores. Se mueve arrastrándola y cada punto por separado. |
| Retroceso de Fibonacci | Botón de Fibonacci con rayas (o Alt+F) y 2 clics: inicio y final. Doble clic para niveles y colores. |
| Posición larga / corta | Botón verde-rojo (larga) o rojo-verde (corta) y un clic en el precio de entrada. Arrastra los puntos azules para mover stop, objetivo, entrada y el final de la caja; arrastra la caja para moverla entera. Al pasar el ratón por encima se ven objetivo, stop, cantidad y ratio riesgo/beneficio. Doble clic para tamaño de cuenta, riesgo y colores. |
| Cambiar de símbolo | Clic en la lista de seguimiento de la derecha. Cambian los 6 gráficos a la vez. Para acciones, oro, plata y forex hay que pegar antes las claves (ver «Acciones, oro, plata y forex»). |
| Añadir un símbolo | Escribe el par (p. ej. `ETHUSDT`) abajo en la lista y pulsa **+**. Para quitarlo, pasa el ratón por encima y pulsa ✕. |
| Mover y ampliar el gráfico | **Arrastra** con el ratón en cualquier dirección (arriba/abajo mueve el precio y quita el encuadre automático; el botón **A** abajo a la derecha lo vuelve a poner). **Rueda** del ratón o pellizco del touchpad: zoom. Dos dedos de lado en el touchpad: desplazarse en el tiempo. Arrastrar la escala de precios la estira o encoge. |
| Cuadrícula / gráfico grande | **Doble clic** en un gráfico lo pone en grande; doble clic otra vez vuelve a los 6. También **Uno grande** (abre el gráfico seleccionado). En grande, **Tab** pasa al siguiente gráfico y **Mayús+Tab** al anterior. |
| Cambiar la temporalidad de un gráfico | Haz clic en el gráfico (queda con borde azul) y pulsa la temporalidad en la barra de arriba (45s, 1m, 2m, 5m, 10m, 15m, 30m, 1h, 3h, 4h, D, S, M). |
| Mostrar/ocultar indicadores | En la leyenda de arriba a la izquierda, con el ojo de cada indicador (como en TradingView). `⌄ 5` despliega la lista y `⌃` la recoge. |
| Configurar medias y medias de otra temporalidad | Botón ⚙ de la leyenda (o clic en el nombre del símbolo de la leyenda). Ahí cambias periodo, tipo (EMA/SMA), color, grosor, y añades medias tipo "EMA 50 de 15m". |
| Línea horizontal | Botón de línea horizontal en la barra de arriba (tras Indicadores) (o **Alt+H**) y clic en el gráfico. Aparece en los 6 gráficos del mismo símbolo. |
| Mover una línea | Arrástrala con el ratón (el cursor cambia a ↕ encima de la línea). |
| Color, grosor (desde 0,5 px), precio exacto o borrar | Haz clic en la línea: arriba aparece la barra de edición. **Supr** la borra, **Esc** la deselecciona. |
| Regla de medir | Botón de la regla en la barra de arriba (tras Indicadores): clic en el punto de inicio y clic en el final. También **Mayúsculas + arrastrar**. Muestra variación, %, ticks, barras, tiempo y volumen. **Esc** la quita. |
| Zoom | Lupas **−** y **+** abajo a la derecha de cada gráfico (o **Alt −** / **Alt +**), además de la rueda del ratón. |
| Encuadre automático | Botón **A** abajo a la derecha (o **Alt+A**). Se apaga si estiras la escala de precios a mano; púlsalo para volver a encuadrar. |
| Escala logarítmica | Botón **L** abajo a la derecha (o **Alt+L**). Se guarda por gráfico. |
| RSI | Doble clic en "RSI" en la leyenda (o ⚙): longitud, fuente, suavizado (RSI-based MA), intervalo de tiempo, bandas 70/50/30, fondo, degradados de sobrecompra/sobreventa y alto del panel. El panel también se agranda arrastrando su línea de separación. |
| Ancho de la lista de seguimiento | Arrastra la línea entre los gráficos y la lista. Las columnas (Último, Cambio, %) se ajustan arrastrando su borde en la cabecera, y se cambian de orden arrastrando su título. Se recuerda en cada ordenador. |
| Ordenar la lista de seguimiento | Arrastra un símbolo arriba o abajo con el ratón. El orden se guarda. |
| Versión | Arriba a la derecha (p. ej. v0.2.0). |
| Más historia | Desplaza el gráfico hacia la izquierda: carga velas antiguas automáticamente. |

Las líneas, la watchlist y la configuración de los gráficos se guardan en el servidor (archivo `datos\graficos.db`). **Copia esa carpeta `datos` si quieres hacer una copia de seguridad.**

El punto de color de arriba a la derecha indica la conexión en tiempo real con Binance: verde = conectado, amarillo = conectando, rojo = sin conexión (reintenta solo).

---

## Acciones, oro, plata y forex (fase 4)

Cada símbolo saca sus datos de una fuente distinta, sin que tengas que elegir nada:

| Mercado | Fuente | Coste | Qué hace falta |
|---|---|---|---|
| Cripto (BTCUSDT…) | Binance | Gratis | Nada |
| Acciones de Nasdaq y NYSE (AAPL, MSTR…) | Alpaca | Gratis (plan Basic) | Cuenta «Paper» y sus claves |
| Oro (XAUUSD), plata (XAGUSD) y divisas (EURUSD…) | Capital.com | Gratis (cuenta demo) | Cuenta demo, 2FA y clave API |

OANDA no deja abrir cuentas demo desde España, por eso el oro y el forex vienen de Capital.com.

### Dónde se pegan las claves

Botón **🔑** de la barra de arriba (a la derecha, muestra el nombre de la fuente del símbolo que estás viendo) → ventana **Fuentes de datos**. Ahí están los pasos para crear cada cuenta, las casillas para pegar las claves y un botón **Probar**. Al cerrar la ventana la app se recarga sola.

Las claves se guardan sólo en este ordenador (en la base de datos de la app), nunca en el código. También se pueden poner como variables de entorno: `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ALPACA_PLAN` (`basic` o `sip`), `CAPITAL_API_KEY`, `CAPITAL_EMAIL`, `CAPITAL_PASSWORD`, `CAPITAL_DEMO` (`1` o `0`).

### Diferencias esperables con TradingView

- **Acciones, plan gratuito de Alpaca.** Las velas de hace más de 15 minutos son de todas las bolsas (precio y volumen completos). Los últimos 15 minutos y el tiempo real vienen sólo de la bolsa IEX: el precio es casi igual, pero el **volumen reciente sale mucho más bajo** (IEX es ≈2-3 % del total). El «NASDAQ por Cboe One» de TradingView gratis también es volumen parcial (Cboe), así que los volúmenes no coincidirán. Para tenerlo todo completo y en tiempo real: plan Algo Trader Plus de Alpaca, 99 $/mes (se elige «De pago» en la ventana).
- **Horario de las acciones:** sólo sesión regular, 9:30-16:00 de Nueva York (15:30-22:00 en España, salvo las semanas de cambio de hora), como TradingView por defecto. La vela de 1h empieza a las 9:30; la de 4h a las 9:30 y a las 13:30.
- **Oro, plata y forex:** precio «bid» de Capital.com. Para comparar con la misma fuente usa en TradingView `CAPITALCOM:GOLD`, `CAPITALCOM:SILVER` o `CAPITALCOM:EURUSD`; frente a `OANDA:XAUUSD` puede haber unos céntimos. No hay volumen. El día empieza a las 17:00 de Nueva York (forex) o a las 18:00 (oro y plata).
- **45 segundos:** en acciones se construye con las operaciones de IEX; en oro y forex no hay histórico de segundos y la vela se va formando mientras la app está abierta.
- **Lista de seguimiento:** acciones, oro y forex se actualizan cada 5 segundos. El «Cambio» de las acciones es frente al cierre anterior.
- Las **alertas** (fase 2) todavía sólo vigilan cripto de Binance.

## Aspecto

Copiado de la configuración de TradingView de Jose: fondo azul marino `#000d2e` sin cuadrícula, velas alcistas huecas blancas y bajistas grises `#4a4a4a`, EMA 20 blanca, EMA 50 roja, SMA 200 morada, medias de otra temporalidad naranjas, líneas horizontales amarillas, valores de los indicadores en el eje derecho y números en formato español (64.663,50). La configuración de Fibonacci y de la caja de posición está en `src/core/toolDefaults.ts`.

## Alertas (fase 2)

### Configurar Telegram (una sola vez, 3 minutos)

1. En Telegram busca **@BotFather** (con la marca azul de verificado), pulsa **INICIAR** y escribe `/newbot`.
2. Ponle un nombre (p. ej. *Alertas Jose*) y un usuario que acabe en `bot` (p. ej. *alertas_jose_elche_bot*).
3. BotFather te da un **token** tipo `7123456789:AAHk…`. Es como una contraseña: no lo compartas.
4. En el programa pulsa **⏰ Alertas → Telegram**, pega el token y pulsa **Guardar token**.
5. En Telegram abre tu bot nuevo y pulsa **INICIAR**. Vuelve al programa y pulsa **Buscar mi chat**.
6. Pulsa **Enviar prueba**: te tiene que llegar un mensaje al móvil.

### Crear alertas

- **Desde una línea:** selecciona una línea horizontal y pulsa **⏰** en la barra de la línea. La alerta queda ligada a la línea: si la mueves, la alerta se mueve; si la borras, se borra. Las líneas con alerta llevan un despertador junto al eje.
- **Desde la ventana Alertas:** botón **＋ Nueva alerta**. Tipo *Precio* (cruce, cruce hacia arriba o hacia abajo) o *RSI* (RSI 14 de diario, semanal, mensual, 4h o 1h cruzando un valor).
- **Sólo una vez** (como en TradingView): al saltar se desactiva; se reactiva con la casilla de la lista. **Cada vez**: salta en cada cruce (como mucho una vez por minuto).
- Cuando salta: mensaje de Telegram, aviso con sonido en el programa y queda apuntada en **Historial**.

### Quién vigila los precios

Las alertas las vigila el **servidor** (no la ventana), con el WebSocket de Binance en tiempo real. Si el WebSocket se cae, mientras se reconecta pregunta el precio cada 5 s. El RSI se revisa cada minuto con la vela en curso.
Si el servidor estuvo apagado y el precio cruzó mientras tanto, la alerta salta al volver a encenderse.

En el programa de Windows el servidor va dentro del programa: **sólo vigila mientras el programa esté abierto**. Para vigilar 24 h con el PC apagado, el mismo servidor se puede poner en un servidor de internet (ver más abajo cuando se elija).

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
- Las alertas (fase 2) de momento sólo funcionan con cripto de Binance.

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
server/alerts.mjs Motor de alertas: WebSocket de Binance, RSI, Telegram (variable opcional TELEGRAM_BOT_TOKEN)
src/ui/alerts.ts  Ventana de alertas, botón ⏰ de la línea y avisos en directo
dist/             Aplicación compilada (lo que sirve el servidor)
```

Comandos (requieren `npm install` la primera vez):

- `npm run dev` → modo desarrollo con recarga automática en <http://localhost:5173> (arranca también `npm start` en otra ventana).
- `npm run build` → comprueba tipos y vuelve a generar `dist/`.
- `npm start` → arranca el servidor.

Proveedores: `src/providers/composite.ts` reparte cada símbolo a su fuente (Binance, Alpaca, Capital.com). Para cambiar o añadir una fuente: crear una clase en `src/providers/` que cumpla `DataProvider` y enrutarla en `composite.ts`. Sólo tiene que dar sus temporalidades nativas; el resto se construye solo. Los horarios de mercado (velas de acciones y forex cortadas como TradingView) están en `src/core/session.ts`. Las claves y las conexiones con Alpaca y Capital.com viven en el servidor (`server/marketdata.mjs`); el navegador sólo ve `/proxy/alpaca`, `/proxy/capital`, `/stream/alpaca` y `/stream/capital`.

Variables de entorno del servidor: `PORT` (3000), `HOST` (127.0.0.1), `DATA_DIR` (`datos`), `OPEN_BROWSER`. Las claves de API de fases futuras irán también en variables de entorno, nunca en el código.

Gráficos hechos con [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/) (licencia Apache 2.0). Se mantiene el logotipo/enlace de atribución en cada gráfico.
