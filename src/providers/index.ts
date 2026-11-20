import { CompositeProvider } from './composite';
import { MockProvider } from './mock';
import type { DataProvider } from './provider';

// Registro de proveedores.
//
//  - Normal: proveedor combinado. Cada símbolo va a su fuente:
//      cripto → Binance, acciones → Alpaca, oro/plata/forex → Capital.com.
//    Para cambiar de fuente basta con tocar providers/composite.ts.
//  - Con ?demo=1 en la dirección: datos inventados (para probar sin internet).

export function createProvider(): DataProvider {
  const params = new URLSearchParams(location.search);
  if (params.get('demo') === '1') return new MockProvider();
  return new CompositeProvider();
}
