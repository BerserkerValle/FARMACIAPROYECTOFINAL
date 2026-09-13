import type { Empleado } from './entidades.js';

export interface EmpleadoModelo extends Empleado {
  id_empleado?: number;
  nombre_completo?: string;
  correo_corporativo?: string | null;
  contrasena?: string | null;
  rol_usuario?: string;
  id_sucursal?: number | null;
  id_supervisor?: number | null;
}

export const tablaEmpleados = 'Empleados' as const;