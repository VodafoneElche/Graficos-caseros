import { BinanceProvider } from './binance';
import { MockProvider } from './mock';
import type { DataProvider } from './provider';

// Registro de proveedores. Para añadir uno nuevo (fase 4: OANDA, Alpaca, Finnhub)
// se crea su clase en esta carpeta y se elige aquí.
//
//  - Normal: Binance.
//  - Con ?demo=1 en la dirección: datos inventados (para probar sin internet).

export function createProvider(): DataProvider {
  const params = new URLSearchParams(location.search);
  if (params.get('demo') === '1') return new MockProvider();
  return new BinanceProvider();
}
