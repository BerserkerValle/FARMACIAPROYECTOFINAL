export interface ClienteModelo {
  id_cliente?: number;
  nombre: string;
  correo: string;
  nit: string;
  telefono?: string | null;
  ultima_modificacion?: string;
  usuario_modifico?: string | null;
}

export const tablaClientes = 'Clientes' as const;