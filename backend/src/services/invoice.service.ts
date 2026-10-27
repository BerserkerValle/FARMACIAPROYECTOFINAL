/**
 * ============================================================================
 * PROYECTO FARMACIA - SERVICIO DE GENERACIÓN DE FACTURAS PDF
 * ============================================================================
 * Este módulo encapsula la lógica de generación de documentos PDF para facturas
 * de venta, tanto para compras en línea (Stripe) como para ventas presenciales (POS).
 *
 * Utiliza PDFKit para crear documentos profesionales con:
 * - Encabezado con datos de la farmacia
 * - Información del cliente y de la operación
 * - Tabla de detalle de productos
 * - Resumen económico (subtotal, descuentos, impuestos, total)
 * - Pie de página con información legal
 * ============================================================================
 */

import PDFDocument from 'pdfkit';
import { PassThrough } from 'node:stream';
import type { Order, OrderItem, Customer, Branch, Invoice, Product } from '../domain.js';
import { store } from '../store.js';
import { databaseEnabled, getDatabaseInvoiceDataForEmail } from '../db.js';

// ============================================================================
// CONFIGURACIÓN Y CONSTANTES
// ============================================================================

const FARMACIA_NOMBRE = process.env.FARMACIA_NOMBRE ?? 'FARMACIA FJK';
const FARMACIA_DIRECCION = process.env.FARMACIA_DIRECCION ?? 'Antigua Guatemala, Guatemala';
const FARMACIA_TELEFONO = process.env.FARMACIA_TELEFONO ?? '+502 4693-2765';
const FARMACIA_EMAIL = process.env.FARMACIA_EMAIL ?? 'ventas@farmaciafjk.com';
const FARMACIA_NIT = process.env.FARMACIA_NIT ?? '12345678-9';

const MONEDA = process.env.MONEDA ?? 'GTQ';
const SIMBOLO_MONEDA = MONEDA === 'GTQ' ? 'Q' : '$';

const COLORES = {
  primario: '#0d9488',
  primarioOscuro: '#0f766e',
  secundario: '#1e293b',
  texto: '#1f2937',
  textoClaro: '#6b7280',
  borde: '#e5e7eb',
  fondoEncabezado: '#f0fdfa',
  fondoFilaPar: '#fafafa',
  fondoFilaImpar: '#ffffff',
  total: '#0d9488'
} as const;

const MARGENES = { top: 50, bottom: 50, left: 50, right: 50 };
const ANCHO_UTIL = 595.28 - MARGENES.left - MARGENES.right; // A4 width minus margins

// ============================================================================
// TIPOS INTERNOS
// ============================================================================

interface FacturaCompleta {
  invoice: Invoice;
  order: Order;
  items: Array<OrderItem & { product: Product }>;
  customer: Customer;
  branch: Branch;
  paymentMethod: string;
  paymentStatus: string;
  isOnline: boolean;
}

interface ColumnaTabla {
  header: string;
  width: number;
  align: 'left' | 'center' | 'right';
  render: (item: OrderItem & { product: Product }, index: number) => string;
}

// ============================================================================
// FUNCIONES AUXILIARES DE FORMATO
// ============================================================================

function formatearMoneda(valor: number): string {
  return SIMBOLO_MONEDA + ' ' + valor.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatearFecha(fechaISO: string): string {
  const fecha = new Date(fechaISO);
  return fecha.toLocaleDateString('es-GT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function truncarTexto(texto: string, maxLongitud: number): string {
  if (texto.length <= maxLongitud) return texto;
  return texto.slice(0, maxLongitud - 3) + '...';
}

function dibujarLinea(doc: PDFKit.PDFDocument, y: number, color: string = COLORES.borde, grosor: number = 0.5) {
  doc.save()
    .moveTo(MARGENES.left, y)
    .lineTo(MARGENES.left + ANCHO_UTIL, y)
    .strokeColor(color)
    .lineWidth(grosor)
    .stroke()
    .restore();
}

function dibujarRectangulo(doc: PDFKit.PDFDocument, x: number, y: number, ancho: number, alto: number, colorFondo: string, colorBorde?: string) {
  doc.save()
    .rect(x, y, ancho, alto)
    .fillColor(colorFondo)
    .fill();
  if (colorBorde) {
    doc.strokeColor(colorBorde).lineWidth(0.5).stroke();
  }
  doc.restore();
}

// ============================================================================
// GENERACIÓN DEL PDF
// ============================================================================

/**
 * Genera el buffer del PDF de la factura.
 * @param factura Objeto con todos los datos necesarios para la factura
 * @returns Promise con el buffer del PDF
 */
export async function generarFacturaPDF(factura: FacturaCompleta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: MARGENES,
        info: {
          Title: 'Factura ' + factura.invoice.invoiceNumber,
          Author: FARMACIA_NOMBRE,
          Subject: 'Factura de venta - ' + factura.order.code,
          Keywords: 'factura, farmacia, venta, medicamentos',
          CreationDate: new Date()
        }
      });

      const chunks: Buffer[] = [];
      const stream = new PassThrough();

      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);

      doc.pipe(stream);

      // Generar el contenido
      dibujarEncabezado(doc, factura);
      dibujarDatosOperacion(doc, factura);
      dibujarDatosCliente(doc, factura);
      dibujarTablaProductos(doc, factura);
      dibujarResumenEconomico(doc, factura);
      dibujarPiePagina(doc, factura);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Dibuja el encabezado de la factura con logo y datos de la farmacia
 */
function dibujarEncabezado(doc: PDFKit.PDFDocument, factura: FacturaCompleta) {
  const yInicio = MARGENES.top;
  let y = yInicio;

  // Fondo del encabezado
  dibujarRectangulo(doc, MARGENES.left, y, ANCHO_UTIL, 80, COLORES.fondoEncabezado, COLORES.primario);

  // Nombre de la farmacia
  doc.save()
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(COLORES.primarioOscuro)
    .text(FARMACIA_NOMBRE, MARGENES.left + 15, y + 10)
    .restore();

  // Datos de contacto
  doc.save()
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORES.textoClaro)
    .text(FARMACIA_DIRECCION, MARGENES.left + 15, y + 38)
    .text('Tel: ' + FARMACIA_TELEFONO + ' | Email: ' + FARMACIA_EMAIL, MARGENES.left + 15, y + 48)
    .text('NIT: ' + FARMACIA_NIT, MARGENES.left + 15, y + 58)
    .restore();

  // Etiqueta FACTURA en la esquina superior derecha
  doc.save()
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(COLORES.primario)
    .text('FACTURA', MARGENES.left + ANCHO_UTIL - 100, y + 15, { width: 90, align: 'right' })
    .fontSize(10)
    .fillColor(COLORES.texto)
    .text('No. ' + factura.invoice.invoiceNumber, MARGENES.left + ANCHO_UTIL - 100, y + 40, { width: 90, align: 'right' })
    .restore();

  y += 95;

  // Línea separadora
  dibujarLinea(doc, y, COLORES.primario, 1.5);
  y += 15;

  // Número de factura y fecha
  doc.save()
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORES.texto)
    .text('Fecha de emisión: ' + formatearFecha(factura.invoice.issuedAt), MARGENES.left, y)
    .text('Tipo: ' + (factura.isOnline ? 'Compra en línea' : 'Venta presencial (POS)'), MARGENES.left + 250, y)
    .restore();

  y += 20;

  // Guardar posición para uso posterior
  (doc as any).yPosition = y;
}

/**
 * Dibuja los datos de la operación (orden, pago, etc.)
 */
function dibujarDatosOperacion(doc: PDFKit.PDFDocument, factura: FacturaCompleta) {
  let y = (doc as any).yPosition ?? MARGENES.top + 120;

  doc.save()
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORES.secundario)
    .text('DATOS DE LA OPERACIÓN', MARGENES.left, y)
    .restore();

  y += 18;

  const datos = [
    { label: 'Número de orden:', valor: factura.order.code },
    { label: 'Número de factura:', valor: factura.invoice.invoiceNumber },
    { label: 'Correlativo SAT:', valor: factura.invoice.satCorrelative },
    { label: 'Estado del pago:', valor: factura.paymentStatus === 'PAID' ? 'PAGADO' : factura.paymentStatus },
    { label: 'Método de pago:', valor: factura.paymentMethod },
    { label: 'Fecha de la orden:', valor: formatearFecha(factura.order.createdAt) },
    { label: 'Fecha de pago:', valor: factura.order.paidAt ? formatearFecha(factura.order.paidAt) : 'N/A' }
  ];

  doc.save().font('Helvetica').fontSize(9).fillColor(COLORES.texto);

  datos.forEach((dato, index) => {
    const col = index % 2;
    const fila = Math.floor(index / 2);
    const x = MARGENES.left + col * 280;
    const yPos = y + fila * 16;

    doc.font('Helvetica-Bold').text(dato.label, x, yPos, { width: 120 });
    doc.font('Helvetica').text(dato.valor, x + 120, yPos, { width: 160 });
  });

  doc.restore();

  y += Math.ceil(datos.length / 2) * 16 + 10;
  dibujarLinea(doc, y);
  y += 10;

  (doc as any).yPosition = y;
}

/**
 * Dibuja los datos del cliente
 */
function dibujarDatosCliente(doc: PDFKit.PDFDocument, factura: FacturaCompleta) {
  let y = (doc as any).yPosition ?? MARGENES.top + 200;

  doc.save()
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORES.secundario)
    .text('DATOS DEL CLIENTE', MARGENES.left, y)
    .restore();

  y += 18;

  const cliente = factura.customer;
  const esConsumidorFinal = cliente.nit === 'CF' || cliente.nit === 'C/F';

  const datosCliente = [
    { label: 'Nombre:', valor: cliente.name },
    { label: esConsumidorFinal ? 'Consumidor Final:' : 'NIT:', valor: cliente.nit },
    { label: 'Correo:', valor: cliente.email },
    { label: 'Teléfono:', valor: cliente.phone }
  ];

  if (cliente.address && !esConsumidorFinal) {
    datosCliente.push({ label: 'Dirección:', valor: cliente.address });
  }

  doc.save().font('Helvetica').fontSize(9).fillColor(COLORES.texto);

  datosCliente.forEach((dato, index) => {
    const col = index % 2;
    const fila = Math.floor(index / 2);
    const x = MARGENES.left + col * 280;
    const yPos = y + fila * 16;

    doc.font('Helvetica-Bold').text(dato.label, x, yPos, { width: 100 });
    doc.font('Helvetica').text(truncarTexto(dato.valor, 50), x + 100, yPos, { width: 180 });
  });

  doc.restore();

  y += Math.ceil(datosCliente.length / 2) * 16 + 10;
  dibujarLinea(doc, y);
  y += 10;

  // Datos del cajero si es venta POS
  if (!factura.isOnline && factura.order.employeeId) {
    doc.save()
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORES.textoClaro)
      .text('Atendido por: Empleado #' + factura.order.employeeId + ' | Sucursal: ' + factura.branch.name, MARGENES.left, y)
      .restore();
    y += 15;
    dibujarLinea(doc, y);
    y += 10;
  }

  (doc as any).yPosition = y;
}

/**
 * Dibuja la tabla de productos
 */
function dibujarTablaProductos(doc: PDFKit.PDFDocument, factura: FacturaCompleta) {
  let y = (doc as any).yPosition ?? MARGENES.top + 300;

  doc.save()
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORES.secundario)
    .text('DETALLE DE PRODUCTOS', MARGENES.left, y)
    .restore();

  y += 18;

  // Definir columnas
  const columnas: ColumnaTabla[] = [
    { header: 'Código', width: 70, align: 'center', render: (item) => item.product.sku ?? '' },
    { header: 'Producto', width: 200, align: 'left', render: (item) => truncarTexto(item.product.name, 35) },
    { header: 'Cant.', width: 45, align: 'center', render: (item) => String(item.quantity) },
    { header: 'P. Unit.', width: 70, align: 'right', render: (item) => formatearMoneda(item.unitPrice) },
    { header: 'Desc.', width: 50, align: 'right', render: () => 'Q 0.00' },
    { header: 'Total', width: 80, align: 'right', render: (item) => formatearMoneda(item.subtotal) }
  ];

  // Encabezado de tabla
  let x = MARGENES.left;
  doc.save()
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(COLORES.texto)
    .rect(MARGENES.left, y, ANCHO_UTIL, 20)
    .fillColor(COLORES.fondoEncabezado)
    .fill();

  columnas.forEach((col) => {
    doc.fillColor(COLORES.secundario)
      .text(col.header, x + 2, y + 5, { width: col.width - 4, align: col.align });
    x += col.width;
  });

  // Líneas verticales del encabezado
  x = MARGENES.left;
  doc.save().strokeColor(COLORES.borde).lineWidth(0.5);
  columnas.forEach((col) => {
    x += col.width;
    if (x < MARGENES.left + ANCHO_UTIL) {
      doc.moveTo(x, y).lineTo(x, y + 20).stroke();
    }
  });
  doc.restore();

  y += 20;

  // Filas de productos
  factura.items.forEach((item, index) => {
    // Verificar salto de página
    if (y > 720) {
      doc.addPage();
      y = MARGENES.top;
      // Redibujar encabezado de tabla en nueva página
      x = MARGENES.left;
      doc.save()
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(COLORES.texto)
        .rect(MARGENES.left, y, ANCHO_UTIL, 20)
        .fillColor(COLORES.fondoEncabezado)
        .fill();
      columnas.forEach((col) => {
        doc.fillColor(COLORES.secundario)
          .text(col.header, x + 2, y + 5, { width: col.width - 4, align: col.align });
        x += col.width;
      });
      y += 20;
    }

    // Fondo de fila alternado
    const colorFondo = index % 2 === 0 ? COLORES.fondoFilaPar : COLORES.fondoFilaImpar;
    doc.save()
      .rect(MARGENES.left, y, ANCHO_UTIL, 22)
      .fillColor(colorFondo)
      .fill()
      .restore();

    // Contenido de la fila
    x = MARGENES.left;
    doc.save().font('Helvetica').fontSize(8).fillColor(COLORES.texto);
    columnas.forEach((col) => {
      const valor = col.render(item, index);
      doc.text(valor, x + 2, y + 6, { width: col.width - 4, align: col.align });
      x += col.width;
    });
    doc.restore();

    // Líneas verticales
    x = MARGENES.left;
    doc.save().strokeColor(COLORES.borde).lineWidth(0.3);
    columnas.forEach((col) => {
      x += col.width;
      if (x < MARGENES.left + ANCHO_UTIL) {
        doc.moveTo(x, y).lineTo(x, y + 22).stroke();
      }
    });
    // Línea horizontal inferior
    doc.moveTo(MARGENES.left, y + 22).lineTo(MARGENES.left + ANCHO_UTIL, y + 22).stroke();
    doc.restore();

    y += 22;
  });

  // Línea final de la tabla
  dibujarLinea(doc, y, COLORES.primario, 1);
  y += 15;

  (doc as any).yPosition = y;
}

/**
 * Dibuja el resumen económico (subtotal, descuentos, impuestos, total)
 */
function dibujarResumenEconomico(doc: PDFKit.PDFDocument, factura: FacturaCompleta) {
  let y = (doc as any).yPosition ?? MARGENES.top + 400;

  const invoice = factura.invoice;
  const subtotal = invoice.subtotal ?? invoice.total;
  const descuento = invoice.discountAmount ?? 0;
  const total = invoice.total;

  // Caja de totales a la derecha
  const anchoCaja = 200;
  const xCaja = MARGENES.left + ANCHO_UTIL - anchoCaja;

  const items = [
    { label: 'Subtotal:', valor: formatearMoneda(subtotal), esTotal: false },
    ...(descuento > 0 ? [{ label: 'Descuento (' + (invoice.discountCode ?? '') + '):', valor: '-' + formatearMoneda(descuento), esTotal: false }] : []),
    { label: 'Total:', valor: formatearMoneda(total), esTotal: true }
  ];

  items.forEach((item, index) => {
    const yItem = y + index * 22;

    if (item.esTotal) {
      // Fondo para total
      dibujarRectangulo(doc, xCaja, yItem - 5, anchoCaja, 30, COLORES.fondoEncabezado, COLORES.primario);
      doc.save()
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(COLORES.total)
        .text(item.label, xCaja + 10, yItem + 2, { width: 80, align: 'right' })
        .text(item.valor, xCaja + 90, yItem + 2, { width: anchoCaja - 100, align: 'right' })
        .restore();
    } else {
      doc.save()
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLORES.texto)
        .text(item.label, xCaja + 10, yItem + 2, { width: 80, align: 'right' })
        .text(item.valor, xCaja + 90, yItem + 2, { width: anchoCaja - 100, align: 'right' })
        .restore();
    }
  });

  y += items.length * 22 + 20;

  // Moneda
  doc.save()
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORES.textoClaro)
    .text('Moneda: ' + MONEDA, xCaja, y, { width: anchoCaja, align: 'right' })
    .restore();

  y += 20;
  dibujarLinea(doc, y, COLORES.primario, 1);
  y += 10;

  (doc as any).yPosition = y;
}

/**
 * Dibuja el pie de página con información legal y notas
 */
function dibujarPiePagina(doc: PDFKit.PDFDocument, factura: FacturaCompleta) {
  let y = (doc as any).yPosition ?? MARGENES.top + 500;

  // Nota legal
  const notaLegal = factura.isOnline
    ? 'Esta factura corresponde a una compra en línea procesada a través de nuestra plataforma web. El pago fue verificado mediante Stripe.'
    : 'Esta factura corresponde a una venta presencial realizada en mostrador. El pago fue recibido directamente en el punto de venta.';

  doc.save()
    .font('Helvetica')
    .fontSize(7)
    .fillColor(COLORES.textoClaro)
    .text('NOTA: Este documento es un comprobante interno de venta emitido por Farmacia FJK.', MARGENES.left, y, { width: ANCHO_UTIL, align: 'center' })
    .text('No constituye una factura fiscal electrónica autorizada (FEL) ante la SAT de Guatemala.', MARGENES.left, y + 12, { width: ANCHO_UTIL, align: 'center' })
    .text(notaLegal, MARGENES.left, y + 24, { width: ANCHO_UTIL, align: 'center' })
    .restore();

  y += 50;

  // Línea final
  dibujarLinea(doc, y, COLORES.borde, 1);
  y += 8;

  // Información de contacto final
  doc.save()
    .font('Helvetica')
    .fontSize(7)
    .fillColor(COLORES.textoClaro)
    .text(FARMACIA_NOMBRE + ' - ' + FARMACIA_DIRECCION + ' - Tel: ' + FARMACIA_TELEFONO + ' - ' + FARMACIA_EMAIL, MARGENES.left, y, { width: ANCHO_UTIL, align: 'center' })
    .text('Documento generado automáticamente el ' + formatearFecha(new Date().toISOString()), MARGENES.left, y + 10, { width: ANCHO_UTIL, align: 'center' })
    .restore();
}

// ============================================================================
// SERVICIO DE ALTO NIVEL: OBTENER DATOS Y GENERAR PDF
// ============================================================================

/**
 * Obtiene todos los datos necesarios y genera el PDF de la factura.
 * Funciona tanto para modo base de datos como modo memoria.
 */
export async function generarFacturaDesdeOrden(
  orderId: number,
  isOnline: boolean,
  forcePaid = false
): Promise<{ pdfBuffer: Buffer; facturaData: FacturaCompleta }> {
  const databaseData = databaseEnabled ? await getDatabaseInvoiceDataForEmail(orderId) : null;
  if (databaseEnabled && !databaseData) throw new Error('No se encontraron datos de factura para la orden #' + orderId);
  const order = databaseData?.order ?? store.getOrderById(orderId);
  if (!order) {
    throw new Error('Orden #' + orderId + ' no encontrada');
  }

  if (forcePaid) {
    order.paymentStatus = 'PAID';
    order.status = 'PAID';
    order.paidAt = order.paidAt ?? new Date().toISOString();
  }

  // Obtener items de la orden con productos
  const items = databaseData?.items ?? store.getOrderItems(orderId);
  if (!items.length) {
    throw new Error('La orden #' + orderId + ' no tiene items');
  }

  // Obtener cliente
  const customer = databaseData?.customer ?? store.getCustomerById(order.customerId);
  if (!customer) {
    throw new Error('Cliente #' + order.customerId + ' no encontrado');
  }

  // Obtener sucursal
  const branch = databaseData?.branch ?? store.getBranchById(order.branchId);
  if (!branch) {
    throw new Error('Sucursal #' + order.branchId + ' no encontrada');
  }

  // Obtener factura asociada
  const invoice = databaseData?.invoice ?? store.getInvoiceByOrderId(orderId);
  if (!invoice) {
    throw new Error('No se encontró factura para la orden #' + orderId);
  }

  // Determinar método de pago
  const payment = databaseData?.payment ?? store.getPaymentByOrderId(orderId);
  const paymentMethod = payment?.provider
    ? payment.provider === 'stripe' ? 'Tarjeta (Stripe)'
      : payment.provider === 'cash' ? 'Efectivo'
      : payment.provider === 'demo' ? 'Demo'
      : payment.provider
    : 'No especificado';

  const facturaData: FacturaCompleta = {
    invoice,
    order,
    items: items.map(item => ({
      ...item,
      product: item.product!
    })),
    customer,
    branch,
    paymentMethod,
    paymentStatus: order.paymentStatus,
    isOnline
  };

  const pdfBuffer = await generarFacturaPDF(facturaData);
  return { pdfBuffer, facturaData };
}

// ============================================================================
// EXPORTACIONES ADICIONALES PARA TESTING
// ============================================================================

export { formatearMoneda, formatearFecha, COLORES, MONEDA, SIMBOLO_MONEDA };
