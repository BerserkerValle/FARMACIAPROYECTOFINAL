import type { Lote } from './entidades.js';

export interface LoteModelo extends Lote {
  id_lote?: number;
  codigo_lote_fabricante?: string;
  id_producto?: number;
  id_detalle_compra?: number | null;
  fecha_vencimiento?: string;
  precio_costo?: number;
  precio_venta?: number;
  id_proveedor?: number;
}

export interface StockSucursalModelo {
  id_sucursal: number;
  id_lote: number;
  cantidad_disponible: number;
  ultima_modificacion?: string;
  usuario_modifico?: string | null;
}

export interface MovimientoInventarioModelo {
  id_movimiento?: number;
  id_lote: number;
  tipo_movimiento: 'ENTRADA' | 'VENTA' | 'DEVOLUCION' | 'AJUSTE' | 'MERMA' | 'TRASLADO';
  cantidad: number;
  fecha?: string;
  id_usuario?: number | null;
  motivo?: string | null;
}

export const tablasInventario = ['Lotes', 'Stock_Sucursal', 'MovimientoInventario'] as const;