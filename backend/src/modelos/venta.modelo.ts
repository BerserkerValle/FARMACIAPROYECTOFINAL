import type { DetallePedido, Factura, Pago, Pedido } from './entidades.js';

export interface FacturaModelo extends Factura {
  id_factura?: number;
  id_cliente?: number | null;
  id_sucursal?: number | null;
  id_empleado_cajero?: number | null;
  correlativo_sat?: string | null;
  total_neto?: number;
}

export interface DetalleFacturaModelo extends DetallePedido {
  id_detalle_factura?: number;
  id_factura?: number;
  id_lote?: number;
  cantidad_vendida?: number;
  precio_venta_aplicado?: number;
}

export interface PagoModelo extends Pago {
  id_pago?: number;
  id_factura?: number;
  id_metodo_pago?: number | null;
  transaccion_pasarela_id?: string | null;
  monto_pagado?: number;
}

export interface PedidoModelo extends Pedido {
  id_pedido?: number;
  id_cliente?: number;
  id_sucursal?: number;
  estado?: string;
}

export const tablasVentas = ['Facturas', 'Detalle_Facturas', 'Pagos', 'Devoluciones'] as const;