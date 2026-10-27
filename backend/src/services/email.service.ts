/**
 * ============================================================================
 * PROYECTO FARMACIA - SERVICIO DE ENVÍO DE CORREOS ELECTRÓNICOS
 * ============================================================================
 * Este módulo encapsula la lógica de envío de correos utilizando Nodemailer.
 * Soporta envío de facturas PDF adjuntas y manejo de reintentos.
 * ============================================================================
 */

import nodemailer from 'nodemailer';
import type { Transporter, SendMailOptions } from 'nodemailer';

// ============================================================================
// CONFIGURACIÓN SMTP
// ============================================================================

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
}

let transporter: Transporter | null = null;
let smtpConfig: SmtpConfig | null = null;

/**
 * Inicializa el transportador SMTP con la configuración de variables de entorno.
 * Debe llamarse al inicio de la aplicación o antes del primer envío.
 */
export function initializeEmailService(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const secure = process.env.SMTP_SECURE?.trim().toLowerCase() === 'true';
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const fromEmail = process.env.SMTP_FROM_EMAIL?.trim() ?? user;
  const fromName = process.env.SMTP_FROM_NAME?.trim() ?? 'FARMACIA FJK';

  if (!host || !user || !pass) {
    console.warn('[EmailService] SMTP no configurado completamente. Variables requeridas: SMTP_HOST, SMTP_USER, SMTP_PASS');
    return false;
  }

  smtpConfig = {
    host,
    port,
    secure,
    auth: { user, pass }
  };

  transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: smtpConfig.auth,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5
  });

  // Verificar conexión
  transporter.verify((error) => {
    if (error) {
      console.error('[EmailService] Error verificando conexión SMTP:', error.message);
    } else {
      console.log('[EmailService] Servidor SMTP listo para enviar correos');
    }
  });

  // Guardar configuración de remitente para uso posterior
  (transporter as any).fromEmail = fromEmail;
  (transporter as any).fromName = fromName;

  return true;
}

/**
 * Verifica si el servicio de correo está configurado y listo.
 */
export function isEmailServiceReady(): boolean {
  return transporter !== null;
}

/**
 * Obtiene el estado del servicio de correo para diagnóstico.
 */
export function getEmailServiceStatus(): { configured: boolean; host?: string; from?: string } {
  if (!transporter) {
    return { configured: false };
  }
  return {
    configured: true,
    host: smtpConfig?.host,
    from: (transporter as any).fromEmail
  };
}

// ============================================================================
// ENVÍO DE CORREOS
// ============================================================================

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Envía un correo electrónico con opciones estándar.
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: SendMailOptions['attachments'];
}): Promise<EmailResult> {
  if (!transporter) {
    return { success: false, error: 'Servicio de correo no configurado. Verifique variables SMTP.' };
  }

  const fromEmail = (transporter as any).fromEmail ?? process.env.SMTP_USER;
  const fromName = (transporter as any).fromName ?? 'FARMACIA FJK';

  const mailOptions: SendMailOptions = {
    from: fromName + ' <' + fromEmail + '>',
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    attachments: options.attachments
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('[EmailService] Correo enviado exitosamente a', options.to, 'MessageID:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido enviando correo';
    console.error('[EmailService] Error enviando correo a', options.to, ':', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Envía la factura PDF por correo al cliente.
 */
export async function sendInvoiceEmail(params: {
  customerEmail: string;
  customerName: string;
  orderCode: string;
  invoiceNumber: string;
  total: number;
  pdfBuffer: Buffer;
  isOnline: boolean;
}): Promise<EmailResult> {
  const moneda = process.env.MONEDA ?? 'GTQ';
  const simbolo = moneda === 'GTQ' ? 'Q' : '$';
  const totalFormateado = simbolo + ' ' + params.total.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const tipoOperacion = params.isOnline ? 'compra en línea' : 'venta presencial';
  const subject = 'Tu factura de Farmacia FJK — Pedido #' + params.orderCode;

  const fontFamily = '-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Oxygen, Ubuntu, sans-serif';

  const html = '<!DOCTYPE html>' +
    '<html lang=\"es\">' +
    '<head>' +
    '<meta charset=\"UTF-8\">' +
    '<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">' +
    '</head>' +
    '<body style=\"font-family: ' + fontFamily + '; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;\">' +
    '<div style=\"background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); border-radius: 12px 12px 0 0; padding: 30px; text-align: center;\">' +
    '<h1 style=\"color: white; margin: 0; font-size: 28px; font-weight: 700;\">FARMACIA FJK</h1>' +
    '<p style=\"color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 16px;\">Tu factura está lista</p>' +
    '</div>' +
    '<div style=\"background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 30px;\">' +
    '<p style=\"font-size: 16px; margin-top: 0;\">Estimado/a <strong>' + params.customerName + '</strong>,</p>' +
    '<p style=\"font-size: 15px;\">Confirmamos que el pago de tu ' + tipoOperacion + ' ha sido procesado correctamente.</p>' +
    '<div style=\"background: #f0fdfa; border: 1px solid #a7f3d0; border-radius: 8px; padding: 20px; margin: 24px 0;\">' +
    '<table style=\"width: 100%; border-collapse: collapse;\">' +
    '<tr>' +
    '<td style=\"padding: 8px 0; color: #6b7280; font-size: 14px;\">Número de pedido:</td>' +
    '<td style=\"padding: 8px 0; font-weight: 600; font-size: 14px; text-align: right;\">' + params.orderCode + '</td>' +
    '</tr>' +
    '<tr>' +
    '<td style=\"padding: 8px 0; color: #6b7280; font-size: 14px;\">Número de factura:</td>' +
    '<td style=\"padding: 8px 0; font-weight: 600; font-size: 14px; text-align: right;\">' + params.invoiceNumber + '</td>' +
    '</tr>' +
    '<tr>' +
    '<td style=\"padding: 8px 0; color: #6b7280; font-size: 14px;\">Total:</td>' +
    '<td style=\"padding: 8px 0; font-weight: 700; font-size: 18px; text-align: right; color: #0d9488;\">' + totalFormateado + '</td>' +
    '</tr>' +
    '<tr>' +
    '<td style=\"padding: 8px 0; color: #6b7280; font-size: 14px;\">Tipo:</td>' +
    '<td style=\"padding: 8px 0; font-weight: 600; font-size: 14px; text-align: right;\">' + tipoOperacion.charAt(0).toUpperCase() + tipoOperacion.slice(1) + '</td>' +
    '</tr>' +
    '</table>' +
    '</div>' +
    '<p style=\"font-size: 15px;\">Adjunto a este correo encontrarás tu factura en formato PDF con el detalle completo de los productos.</p>' +
    '<p style=\"font-size: 14px; color: #6b7280; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;\">' +
    '<strong>Nota:</strong> Este documento es un comprobante interno de venta emitido por Farmacia FJK. ' +
    'No constituye una factura fiscal electrónica autorizada (FEL) ante la SAT de Guatemala.' +
    '</p>' +
    '<div style=\"margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 13px;\">' +
    '<p style=\"margin: 4px 0;\">FARMACIA FJK</p>' +
    '<p style=\"margin: 4px 0;\">Antigua Guatemala, Guatemala</p>' +
    '<p style=\"margin: 4px 0;\">Tel: +502 2345-6789 | ventas@farmaciafjk.com</p>' +
    '</div>' +
    '</div>' +
    '</body>' +
    '</html>';

  const text = 'Estimado/a ' + params.customerName + ',\n\n' +
    'Confirmamos que el pago de tu ' + tipoOperacion + ' ha sido procesado correctamente.\n\n' +
    'Detalles:\n' +
    '- Número de pedido: ' + params.orderCode + '\n' +
    '- Número de factura: ' + params.invoiceNumber + '\n' +
    '- Total: ' + totalFormateado + '\n' +
    '- Tipo: ' + tipoOperacion.charAt(0).toUpperCase() + tipoOperacion.slice(1) + '\n\n' +
    'Adjunto a este correo encontrarás tu factura en formato PDF con el detalle completo de los productos.\n\n' +
    'Nota: Este documento es un comprobante interno de venta emitido por Farmacia FJK.\n' +
    'No constituye una factura fiscal electrónica autorizada (FEL) ante la SAT de Guatemala.\n\n' +
    '---\n' +
    'FARMACIA FJK\n' +
    'Antigua Guatemala, Guatemala\n' +
    'Tel: +502 4693-2765 | ventas@farmaciafjk.com';

  return sendEmail({
    to: params.customerEmail,
    subject,
    html,
    text,
    attachments: [
      {
        filename: 'factura-' + params.invoiceNumber + '.pdf',
        content: params.pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });
}

/**
 * Cierra la conexión del transportador (para shutdown graceful).
 */
export async function closeEmailService(): Promise<void> {
  if (transporter) {
    transporter.close();
    transporter = null;
    console.log('[EmailService] Conexión SMTP cerrada');
  }
}
