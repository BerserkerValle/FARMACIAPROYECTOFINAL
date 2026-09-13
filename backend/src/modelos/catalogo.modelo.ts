import type { Categoria, Proveedor, Sucursal } from './entidades.js';

export interface SucursalModelo extends Sucursal {
  id_sucursal?: number;
  nombre_sucursal?: string;
}

export interface CategoriaModelo extends Categoria {
  id_categoria?: number;
  nombre_categoria?: string;
  id_categoria_padre?: number | null;
}

export interface ProveedorModelo extends Proveedor {
  id_proveedor?: number;
  nombre_proveedor?: string;
  estado?: string;
}

export const tablasCatalogo = ['Sucursales', 'Categorias', 'Proveedores'] as const;