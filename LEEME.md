# Tienda digital con QvaPay — cómo funciona y cómo ponerla a andar

## Qué hace cada parte

1. **`public/index.html`** — la página del producto. El comprador pone su
   correo y pulsa "Pagar con QvaPay".
2. **`server.js`** — tu servidor. Crea la factura en QvaPay (guardando el
   token secreto ahí, nunca en la página), y cuando QvaPay confirma el pago
   (webhook), envía el archivo por correo automáticamente.
3. **`public/gracias.html`** — a donde QvaPay devuelve al comprador. Revisa
   si ya se confirmó el pago y muestra el botón de descarga.
4. **`archivos-privados/`** — aquí pones el archivo que vendes (PDF, ZIP,
   etc.). No es una carpeta pública; solo el servidor puede leerla.

## Por qué hace falta un servidor (y no basta con la página HTML sola)

El token de QvaPay es una credencial secreta. Si se escribiera directamente
en el HTML, cualquier persona que abra el código fuente de la página podría
copiarlo y generar facturas a tu nombre. Por eso la página solo le habla a
tu propio servidor, y es el servidor quien le habla a QvaPay.

Esto también es lo que hace posible el envío **automático**: cuando QvaPay
confirma el pago, no se lo dice a la página del comprador — se lo dice a tu
servidor (vía el "webhook"), y es tu servidor quien entonces manda el correo.
Sin un servidor con una dirección pública, no hay forma de recibir esa
confirmación de forma automática.

## Pasos para ponerla a funcionar

1. **Crea tu app en QvaPay**: ve a qvapay.com/dev/apps → crea una app (nombre,
   descripción, URL de tu web, URL de webhook) → copia el `APP_ID` y el
   `APP_SECRET` que te den.
2. **Copia `.env.example` a `.env`** y completa:
   - `QVAPAY_APP_ID` y `QVAPAY_APP_SECRET` con lo que copiaste.
   - `PUBLIC_URL` con la URL donde vas a publicar esta tienda.
   - Datos SMTP si quieres que el archivo se envíe por correo automáticamente
     (con Gmail necesitas una "contraseña de aplicación", no tu contraseña
     normal).
3. **Pon tu archivo** dentro de `archivos-privados/` con el mismo nombre que
   pusiste en `NOMBRE_ARCHIVO_PRODUCTO`.
4. **Edita `public/index.html`**: cambia el objeto `CONFIG` (nombre,
   descripción, precio, imagen) al inicio del `<script>`.
5. **Instala y corre localmente para probar**:
   ```
   npm install
   npm start
   ```
6. **Publícala en un hosting con servidor persistente** (esto NO es un sitio
   estático, necesita Node corriendo todo el tiempo para poder recibir el
   webhook). Opciones sencillas y con capa gratuita: Render, Railway o
   Fly.io. El proceso general en cualquiera de ellas es: subir este proyecto
   a un repositorio de GitHub, conectarlo, y configurar las mismas variables
   de entorno del `.env` en el panel del servicio.
7. Vuelve al panel de tu app en qvapay.com/dev/apps y pon como **Webhook
   URL**: `https://tu-dominio.com/api/webhook` (con tu dominio real de
   Render/Railway). Esto se configura una sola vez, no por cada venta.

## Formato real de la API (confirmado)

- Crear factura: `POST https://api.qvapay.com/v2/create_invoice` con
  `app_id`, `app_secret`, `amount`, `description`, `remote_id` en el cuerpo.
  Responde con `url` (o `signedUrl`, válida 30 min) — ahí rediriges al
  comprador.
- Confirmación de pago: QvaPay hace `POST` a tu webhook con
  `{ remote_id, id, uuid, status: 'paid'|'cancelled' }`.
- Consultar una transacción manualmente: `GET https://api.qvapay.com/transaction/{uuid}`.

Aun así, antes de vender de verdad: haz una compra de prueba tú mismo por un
monto pequeño (ej. $0.01) y revisa los "Logs" de tu hosting para confirmar
que el webhook llega y el correo se envía correctamente.

## Seguridad

- Nunca subas tu archivo `.env` real a un repositorio público.
- El enlace de descarga solo funciona después de que el pedido quede
  marcado como pagado, y usa un token aleatorio impredecible.
