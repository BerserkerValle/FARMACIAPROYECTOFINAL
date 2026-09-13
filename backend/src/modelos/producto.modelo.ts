import type { Producto } from './entidades.js';

export interface ProductoModelo extends Producto {
  id_producto?: number;
  sku_codigo?: string;
  nombre_producto?: string;
  id_categoria?: number | null;
  requiere_receta?: boolean;
  marca?: string | null;
  laboratorio?: string | null;
  presentacion?: string | null;
  unidad_medida?: string | null;
  registro_sanitario?: string | null;
}

export const tablaProductos = 'Productos' as const;