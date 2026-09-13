// server.js
// Backend mínimo para: 1) crear la factura en QvaPay, 2) recibir la confirmación
// de pago (webhook), 3) entregar el archivo automáticamente (email + descarga).
//
// Por qué hace falta un backend y no basta con la página HTML sola:
// QVAPAY_API_TOKEN es un secreto — si se pusiera en el HTML, cualquier
// visitante podría verlo y generar facturas o robarlo. Por eso la página
// solo llama a TU servidor, y es el servidor quien habla con QvaPay.

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const PRIVATE_FILES_DIR = path.join(__dirname, 'archivos-privados');

// --- almacenamiento simple en un archivo JSON (suficiente para un solo producto/bajo volumen) ---
function readOrders() {
  if (!fs.existsSync(ORDERS_FILE)) return {};
  return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8') || '{}');
}
function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// --- correo (opcional pero recomendado para la entrega automática) ---
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

async function enviarArchivoPorCorreo(destinatario, nombreProducto, rutaArchivo) {
  if (!mailer) return false;
  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: destinatario,
    subject: `Tu compra: ${nombreProducto}`,
    text: `Gracias por tu compra. Adjunto encontrarás tu archivo: ${nombreProducto}.`,
    attachments: [{ filename: path.basename(rutaArchivo), path: rutaArchivo }],
  });
  return true;
}

// 1) Crear factura -----------------------------------------------------------
app.post('/api/checkout', async (req, res) => {
  try {
    const { amount, description, remote_id, email } = req.body;
    if (!amount || !description || !remote_id || !email) {
      return res.status(400).json({ error: 'Faltan datos (amount, description, remote_id, email)' });
    }

    const base = process.env.PUBLIC_URL; // ej: https://tu-dominio.com
    const response = await fetch('https://api.qvapay.com/v2/create_invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: process.env.QVAPAY_APP_ID,
        app_secret: process.env.QVAPAY_APP_SECRET,
        amount,
        description,
        remote_id,
        signed: 1,
        // A dónde vuelve el comprador tras pagar en QvaPay:
        return_url: `${base}/gracias.html?order=${encodeURIComponent(remote_id)}`,
        cancel_url: `${base}/index.html`,
      }),
    });

    const data = await response.json();
    if (!response.ok || !(data.url || data.signedUrl)) {
      console.error('Error de QvaPay:', data);
      return res.status(502).json({ error: 'QvaPay no pudo crear la factura' });
    }

    const orders = readOrders();
    orders[remote_id] = {
      email,
      description,
      amount,
      status: 'pending',
      createdAt: Date.now(),
      qvapay_uuid: data.transation_uuid || null,
    };
    writeOrders(orders);

    res.json({ url: data.signedUrl || data.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// 2) Webhook: QvaPay confirma el pago aquí -----------------------------------
// IMPORTANTE: esta URL pública (https://tu-dominio.com/api/webhook) se
// configura UNA SOLA VEZ en el panel de tu app (qvapay.com/dev/apps),
// no en cada factura.
app.post('/api/webhook', async (req, res) => {
  try {
    const payload = req.body;
    // El campo exacto puede variar; QvaPay suele reenviar el remote_id y el status.
    const remote_id = payload.remote_id || payload.data?.remote_id;
    const status = payload.status || payload.data?.status; // ej: "paid" / "completed"

    if (!remote_id) return res.status(400).send('Falta remote_id');

    const orders = readOrders();
    const order = orders[remote_id];
    if (!order) return res.status(404).send('Pedido no encontrado');

    const pagado = ['paid', 'completed', 'success'].includes(String(status).toLowerCase());
    if (pagado && order.status !== 'paid') {
      order.status = 'paid';
      order.downloadToken = crypto.randomBytes(24).toString('hex');
      writeOrders({ ...orders, [remote_id]: order });

      // Entrega automática por correo:
      const rutaArchivo = path.join(PRIVATE_FILES_DIR, process.env.NOMBRE_ARCHIVO_PRODUCTO || 'producto.pdf');
      if (fs.existsSync(rutaArchivo)) {
        await enviarArchivoPorCorreo(order.email, order.description, rutaArchivo);
      } else {
        console.warn('No se encontró el archivo del producto en', rutaArchivo);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// 3) Estado del pedido (para la página de gracias) ---------------------------
app.get('/api/status/:remote_id', (req, res) => {
  const orders = readOrders();
  const order = orders[req.params.remote_id];
  if (!order) return res.json({ status: 'not_found' });

  res.json({
    status: order.status,
    downloadUrl:
      order.status === 'paid'
        ? `/descargar/${encodeURIComponent(req.params.remote_id)}/${order.downloadToken}`
        : null,
  });
});

// 4) Descarga protegida (solo funciona tras pago confirmado) -----------------
app.get('/descargar/:remote_id/:token', (req, res) => {
  const orders = readOrders();
  const order = orders[req.params.remote_id];
  if (!order || order.status !== 'paid' || order.downloadToken !== req.params.token) {
    return res.status(403).send('Enlace inválido o pago no confirmado.');
  }
  const rutaArchivo = path.join(PRIVATE_FILES_DIR, process.env.NOMBRE_ARCHIVO_PRODUCTO || 'producto.pdf');
  res.download(rutaArchivo);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
