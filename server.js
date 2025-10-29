require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// SumUp credentials
const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
const SUMUP_CLIENT_ID = process.env.SUMUP_CLIENT_ID;
const SUMUP_BASE_URL = 'https://api.sumup.com/v0.1';
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// Shopify credentials
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'gdicex-x1.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = '2024-10';

// In-memory storage voor orders (in productie gebruik je een database)
const pendingOrders = new Map();

// Test endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'active',
    message: 'Shopify-SumUp Payment Gateway is running',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Test SumUp connection with detailed error info
app.get('/test-sumup', async (req, res) => {
  try {
    console.log('Testing SumUp with API Key:', SUMUP_API_KEY ? 'Present' : 'Missing');
    
    const response = await axios.get(`${SUMUP_BASE_URL}/me`, {
      headers: {
        'Authorization': `Bearer ${SUMUP_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    res.json({
      status: 'success',
      message: 'SumUp connection successful',
      merchant: response.data
    });
  } catch (error) {
    console.error('SumUp API Error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      headers: error.response?.headers
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      statusCode: error.response?.status,
      details: error.response?.data,
      hint: 'Check if your API key is valid and has the correct permissions'
    });
  }
});

// Get OAuth token (if you have client credentials)
app.get('/get-token', async (req, res) => {
  try {
    // This is for getting a new access token using client credentials
    const response = await axios.post('https://api.sumup.com/token', {
      grant_type: 'client_credentials',
      client_id: SUMUP_CLIENT_ID,
      client_secret: process.env.SUMUP_CLIENT_SECRET || ''
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    res.json({
      status: 'success',
      message: 'Token generated',
      token: response.data
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      details: error.response?.data,
      hint: 'You might need a Client Secret for this'
    });
  }
});

// Create Shopify order
async function createShopifyOrder(customerData, cartData, checkoutId, transactionData) {
  try {
    console.log('Creating Shopify order...');
    console.log('Customer data:', customerData);
    console.log('Cart data:', cartData);
    
    // Prepare order data
    const orderData = {
      order: {
        email: customerData.email,
        financial_status: 'paid',
        fulfillment_status: null,
        send_receipt: true,
        send_fulfillment_receipt: false,
        note: `Pagado via SumUp. Checkout ID: ${checkoutId}`,
        line_items: cartData.items.map(item => ({
          variant_id: item.variant_id,
          quantity: item.quantity,
          price: (item.price / 100).toFixed(2)
        })),
        customer: {
          first_name: customerData.firstName,
          last_name: customerData.lastName,
          email: customerData.email,
          phone: customerData.phone || ''
        },
        billing_address: {
          first_name: customerData.firstName,
          last_name: customerData.lastName,
          address1: customerData.address,
          phone: customerData.phone || '',
          city: customerData.city,
          zip: customerData.postalCode,
          country: customerData.country
        },
        shipping_address: {
          first_name: customerData.firstName,
          last_name: customerData.lastName,
          address1: customerData.address,
          phone: customerData.phone || '',
          city: customerData.city,
          zip: customerData.postalCode,
          country: customerData.country
        },
        transactions: [
          {
            kind: 'sale',
            status: 'success',
            amount: (cartData.total_price / 100).toFixed(2),
            currency: cartData.currency || 'EUR',
            gateway: 'SumUp',
            authorization: transactionData.transaction_code || checkoutId
          }
        ],
        tags: 'SumUp, Paid'
      }
    };

    console.log('Sending order to Shopify:', JSON.stringify(orderData, null, 2));

    const response = await axios.post(
      `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders.json`,
      orderData,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Shopify order created successfully:', response.data.order.id);
    return response.data.order;

  } catch (error) {
    console.error('Error creating Shopify order:', error.message);
    console.error('Error details:', error.response?.data);
    throw error;
  }
}

// Save customer data endpoint
app.post('/api/save-customer-data', async (req, res) => {
  try {
    const { checkoutId, customerData, cartData } = req.body;
    
    console.log('Saving customer data for checkout:', checkoutId);
    console.log('Customer:', customerData);
    
    // Get transaction details from SumUp
    const checkoutResponse = await axios.get(`${SUMUP_BASE_URL}/checkouts/${checkoutId}`, {
      headers: {
        'Authorization': `Bearer ${SUMUP_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const checkout = checkoutResponse.data;
    
    // Check if there's a successful transaction
    let transactionData = {};
    if (checkout.transactions && checkout.transactions.length > 0) {
      const successfulTxn = checkout.transactions.find(txn => txn.status === 'SUCCESSFUL');
      if (successfulTxn) {
        transactionData = successfulTxn;
      }
    }
    
    // If we have cart data, create Shopify order
    if (cartData && cartData.items && cartData.items.length > 0) {
      try {
        const shopifyOrder = await createShopifyOrder(customerData, cartData, checkoutId, transactionData);
        console.log('Shopify order created:', shopifyOrder.id);
        
        res.json({
          status: 'success',
          message: 'Customer data saved and Shopify order created',
          shopify_order_id: shopifyOrder.id,
          shopify_order_number: shopifyOrder.order_number
        });
      } catch (shopifyError) {
        console.error('Failed to create Shopify order, but customer data saved');
        res.json({
          status: 'partial_success',
          message: 'Customer data saved but Shopify order creation failed',
          error: shopifyError.message
        });
      }
    } else {
      // Just save customer data without creating order
      console.log('No cart data provided, skipping Shopify order creation');
      res.json({
        status: 'success',
        message: 'Customer data saved'
      });
    }
    
  } catch (error) {
    console.error('Error in save-customer-data:', error.message);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Check payment status endpoint
app.get('/api/check-payment/:checkoutId', async (req, res) => {
  const { checkoutId } = req.params;
  
  try {
    const response = await axios.get(`${SUMUP_BASE_URL}/checkouts/${checkoutId}`, {
      headers: {
        'Authorization': `Bearer ${SUMUP_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const checkout = response.data;
    console.log('=== CHECKOUT STATUS ===');
    console.log('Status:', checkout.status);
    console.log('Checkout ID:', checkout.id);
    console.log('Amount:', checkout.amount, checkout.currency);
    
    // Log full checkout object for debugging
    console.log('=== FULL CHECKOUT DETAILS ===');
    console.log(JSON.stringify(checkout, null, 2));
    
    // Check if payment is successful (can be PAID or have SUCCESSFUL transactions)
    let actualStatus = checkout.status;
    
    // If checkout has transactions, check if any are SUCCESSFUL
    if (checkout.transactions && checkout.transactions.length > 0) {
      const successfulTxn = checkout.transactions.find(txn => txn.status === 'SUCCESSFUL');
      if (successfulTxn) {
        actualStatus = 'PAID';
        console.log('Found SUCCESSFUL transaction - treating as PAID');
      }
    }
    
    // If failed, try to get more details
    if (checkout.status === 'FAILED') {
      console.log('=== PAYMENT FAILED ===');
      console.log('Transaction code:', checkout.transaction_code);
      console.log('Transaction ID:', checkout.transaction_id);
      console.log('Date:', checkout.date);
      console.log('Valid until:', checkout.valid_until);
      
      // Check if there are transactions array with failure details
      if (checkout.transactions && checkout.transactions.length > 0) {
        console.log('=== TRANSACTION DETAILS ===');
        checkout.transactions.forEach((txn, index) => {
          console.log(`Transaction ${index + 1}:`, JSON.stringify(txn, null, 2));
        });
      }
      
      // Try to fetch transaction details if transaction_id exists
      if (checkout.transaction_id) {
        try {
          const txnResponse = await axios.get(`${SUMUP_BASE_URL}/me/transactions/${checkout.transaction_id}`, {
            headers: {
              'Authorization': `Bearer ${SUMUP_API_KEY}`,
              'Content-Type': 'application/json'
            }
          });
          console.log('=== TRANSACTION API RESPONSE ===');
          console.log(JSON.stringify(txnResponse.data, null, 2));
        } catch (txnError) {
          console.log('Could not fetch transaction details:', txnError.message);
        }
      }
    }
    
    res.json({
      status: actualStatus,
      checkout: checkout
    });
  } catch (error) {
    console.error('Error checking payment:', error.message);
    console.error('Error response:', error.response?.data);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Checkout pagina - hier komt de klant naartoe vanaf Shopify
app.get('/checkout', async (req, res) => {
  const { amount, currency, order_id, return_url, cart_token } = req.query;
  
  if (!amount || !currency) {
    return res.status(400).send('Faltan parámetros requeridos: monto y moneda');
  }

  // Add timestamp to make each attempt unique (only if order_id exists)
  const checkoutRef = order_id ? `shopify-${order_id}-${Date.now()}` : `shopify-${Date.now()}`;

  try {
    const checkoutData = {
      checkout_reference: checkoutRef,
      amount: parseFloat(amount),
      currency: currency.toUpperCase(),
      pay_to_email: 'yurkovsergii@gmail.com',
      description: `Pedido Shopify ${order_id || ''}`
    };

    console.log('Creating SumUp checkout:', checkoutData);

    const sumupResponse = await axios.post(
      `${SUMUP_BASE_URL}/checkouts`,
      checkoutData,
      {
        headers: {
          'Authorization': `Bearer ${SUMUP_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const checkout = sumupResponse.data;
    console.log('SumUp checkout created:', checkout.id);
    
    // Sla order info op
    if (order_id) {
      pendingOrders.set(checkout.id, {
        order_id,
        cart_token,
        amount,
        currency,
        return_url,
        created_at: new Date()
      });
    }

    // Show payment page with customer details form and SumUp Card Widget
    res.send(`
      <html>
        <head>
          <title>Pagar - € ${amount}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <script src="https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js"></script>
          <style>
            * {
              box-sizing: border-box;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
              background: #f5f5f5;
              padding: 20px;
              margin: 0;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background: white;
              border-radius: 10px;
              padding: 30px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
              text-align: center;
              color: #333;
              margin-bottom: 10px;
              font-size: 28px;
            }
            .amount {
              text-align: center;
              font-size: 48px;
              font-weight: bold;
              color: #000;
              margin: 20px 0;
            }
            .description {
              text-align: center;
              color: #666;
              margin-bottom: 30px;
              font-size: 14px;
            }
            .section {
              margin: 30px 0;
              padding: 20px 0;
              border-top: 1px solid #e0e0e0;
            }
            .section:first-child {
              border-top: none;
              padding-top: 0;
            }
            .section-title {
              font-size: 18px;
              font-weight: 600;
              color: #333;
              margin-bottom: 15px;
            }
            .form-group {
              margin-bottom: 15px;
            }
            label {
              display: block;
              font-size: 14px;
              color: #555;
              margin-bottom: 5px;
              font-weight: 500;
            }
            input {
              width: 100%;
              padding: 12px;
              border: 1px solid #ddd;
              border-radius: 5px;
              font-size: 14px;
              font-family: inherit;
            }
            input:focus {
              outline: none;
              border-color: #000;
            }
            .form-row {
              display: flex;
              gap: 15px;
            }
            .form-row .form-group {
              flex: 1;
            }
            #sumup-card {
              margin: 20px 0;
            }
            .secure {
              text-align: center;
              color: #999;
              font-size: 12px;
              margin-top: 20px;
            }
            .error {
              background: #ffebee;
              color: #c62828;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
              display: none;
            }
            .success {
              background: #e8f5e9;
              color: #2e7d32;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
              display: none;
            }
            .back-button {
              display: block;
              text-align: center;
              color: #666;
              text-decoration: none;
              margin-top: 20px;
              padding: 10px;
              font-size: 14px;
            }
            .back-button:hover {
              color: #000;
            }
            .loading {
              display: none;
              text-align: center;
              padding: 20px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🛒 Pagar</h1>
            <div class="amount">€ ${amount}</div>
            <div class="description">Pedido ${order_id || ''}</div>
            
            <div id="error-message" class="error"></div>
            <div id="success-message" class="success"></div>
            <div id="loading-message" class="loading">Procesando pago...</div>
            
            <!-- Customer Details Section -->
            <div class="section">
              <div class="section-title">Información del Cliente</div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="firstName">Nombre *</label>
                  <input type="text" id="firstName" placeholder="Juan" required>
                </div>
                <div class="form-group">
                  <label for="lastName">Apellido *</label>
                  <input type="text" id="lastName" placeholder="García" required>
                </div>
              </div>
              
              <div class="form-group">
                <label for="email">Correo Electrónico *</label>
                <input type="email" id="email" placeholder="juan@ejemplo.com" required>
              </div>
              
              <div class="form-group">
                <label for="phone">Número de Teléfono</label>
                <input type="tel" id="phone" placeholder="+34 612 345 678">
              </div>
            </div>

            <!-- Billing Address Section -->
            <div class="section">
              <div class="section-title">Dirección de Facturación</div>
              
              <div class="form-group">
                <label for="address">Dirección *</label>
                <input type="text" id="address" placeholder="Calle Gran Vía 123" required>
              </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="postalCode">Código Postal *</label>
                  <input type="text" id="postalCode" placeholder="28013" required>
                </div>
                <div class="form-group">
                  <label for="city">Ciudad *</label>
                  <input type="text" id="city" placeholder="Madrid" required>
                </div>
              </div>
              
              <div class="form-group">
                <label for="country">País *</label>
                <input type="text" id="country" value="España" required>
              </div>
            </div>

            <!-- Payment Section -->
            <div class="section">
              <div class="section-title">Detalles de Pago</div>
              <div id="sumup-card"></div>
            </div>
            
            <div class="secure">
              🔒 Pago seguro con SumUp
            </div>
            
            ${return_url ? `<a href="${return_url}" class="back-button">← Volver a la tienda</a>` : ''}
          </div>

          <script>
            // Store customer data when payment is successful
            let customerData = {};
            let cartData = null;
            const checkoutId = '${checkout.id}';
            let pollingInterval = null;

            // Get cart data from Shopify
            async function getCartData() {
              try {
                const response = await fetch('https://gdicex-x1.myshopify.com/cart.js');
                const cart = await response.json();
                cartData = cart;
                console.log('Cart data loaded:', cartData);
              } catch (error) {
                console.error('Error loading cart data:', error);
              }
            }

            // Load cart data on page load
            getCartData();

            function validateCustomerInfo() {
              const firstName = document.getElementById('firstName').value.trim();
              const lastName = document.getElementById('lastName').value.trim();
              const email = document.getElementById('email').value.trim();
              const address = document.getElementById('address').value.trim();
              const postalCode = document.getElementById('postalCode').value.trim();
              const city = document.getElementById('city').value.trim();
              const country = document.getElementById('country').value.trim();
              
              if (!firstName || !lastName || !email || !address || !postalCode || !city || !country) {
                return false;
              }
              
              customerData = {
                firstName,
                lastName,
                email,
                phone: document.getElementById('phone').value.trim(),
                address,
                postalCode,
                city,
                country
              };
              
              return true;
            }

            async function checkPaymentStatus() {
              try {
                const response = await fetch('/api/check-payment/' + checkoutId);
                const data = await response.json();
                
                console.log('Payment status check:', data);
                
                if (data.status === 'PAID') {
                  // Stop polling
                  if (pollingInterval) {
                    clearInterval(pollingInterval);
                  }
                  
                  // Send customer data and cart data to backend to create Shopify order
                  await fetch('/api/save-customer-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      checkoutId: checkoutId,
                      customerData: customerData,
                      cartData: cartData
                    })
                  });
                  
                  document.getElementById('loading-message').style.display = 'none';
                  document.getElementById('success-message').style.display = 'block';
                  document.getElementById('success-message').innerHTML = '✓ ¡Pago exitoso! Creando pedido...';
                  
                  setTimeout(() => {
                    const returnUrl = '${return_url || APP_URL + '/payment/success'}';
                    const separator = returnUrl.includes('?') ? '&' : '?';
                    window.location.href = returnUrl + separator + 'checkout_id=' + checkoutId;
                  }, 2000);
                } else if (data.status === 'FAILED') {
                  // Stop polling
                  if (pollingInterval) {
                    clearInterval(pollingInterval);
                  }
                  
                  console.error('Payment FAILED - Full details:', data);
                  
                  document.getElementById('loading-message').style.display = 'none';
                  document.getElementById('error-message').style.display = 'block';
                  document.getElementById('error-message').innerHTML = '✗ Pago fallido. La transacción no se pudo completar. Por favor, inténtalo de nuevo o contacta con soporte. (ID: ' + checkoutId + ')';
                } else if (data.status === 'PENDING') {
                  console.log('Payment still PENDING, continuing to poll...');
                } else {
                  console.log('Unknown payment status:', data.status);
                }
              } catch (error) {
                console.error('Error checking payment status:', error);
              }
            }

            function startPolling() {
              console.log('Starting payment status polling...');
              // Check immediately
              checkPaymentStatus();
              // Then check every 2 seconds
              pollingInterval = setInterval(checkPaymentStatus, 2000);
              
              // Stop polling after 2 minutes
              setTimeout(() => {
                if (pollingInterval) {
                  clearInterval(pollingInterval);
                  console.log('Stopped polling after timeout');
                }
              }, 120000);
            }

            // Listen for page visibility changes (when user returns from bank app)
            document.addEventListener('visibilitychange', function() {
              if (!document.hidden && pollingInterval) {
                console.log('Page became visible again - checking payment status');
                checkPaymentStatus();
              }
            });

            // Initialize SumUp Card Widget
            SumUpCard.mount({
              checkoutId: checkoutId,
              showSubmitButton: true,
              locale: 'es-ES',
              onResponse: function(type, body) {
                console.log('SumUp Widget Event:', type, body);
                
                const errorDiv = document.getElementById('error-message');
                const successDiv = document.getElementById('success-message');
                const loadingDiv = document.getElementById('loading-message');
                
                switch(type) {
                  case 'sent':
                    console.log('Payment sent to SumUp');
                    // Validate customer info before processing
                    if (!validateCustomerInfo()) {
                      errorDiv.style.display = 'block';
                      errorDiv.innerHTML = '✗ Por favor, completa todos los campos obligatorios';
                      return;
                    }
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Procesando pago...';
                    // Start polling immediately when payment is sent
                    startPolling();
                    break;
                    
                  case 'auth-screen':
                    console.log('3DS authentication screen shown');
                    // 3DS authentication in progress
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Verificando pago... Por favor, completa la autenticación 3D Secure.';
                    // Make sure polling is running
                    if (!pollingInterval) {
                      startPolling();
                    }
                    break;
                    
                  case 'success':
                    console.log('Widget reported success');
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Confirmando pago...';
                    
                    // Save customer data
                    console.log('Customer data:', customerData);
                    
                    // Make sure polling is running
                    if (!pollingInterval) {
                      startPolling();
                    }
                    break;
                    
                  case 'error':
                    console.log('Widget reported error:', body);
                    if (pollingInterval) {
                      clearInterval(pollingInterval);
                    }
                    loadingDiv.style.display = 'none';
                    errorDiv.style.display = 'block';
                    errorDiv.innerHTML = '✗ Pago fallido: ' + (body.message || 'Por favor, inténtalo de nuevo');
                    break;
                    
                  case 'invalid':
                    console.log('Widget reported invalid data');
                    if (pollingInterval) {
                      clearInterval(pollingInterval);
                    }
                    loadingDiv.style.display = 'none';
                    errorDiv.style.display = 'block';
                    errorDiv.innerHTML = '✗ Datos de pago inválidos. Por favor, verifica la información de tu tarjeta.';
                    break;
                    
                  default:
                    console.log('Unknown widget event:', type);
                }
              }
            });

            // Add input validation styling
            const inputs = document.querySelectorAll('input[required]');
            inputs.forEach(input => {
              input.addEventListener('blur', function() {
                if (!this.value.trim()) {
                  this.style.borderColor = '#f44336';
                } else {
                  this.style.borderColor = '#ddd';
                }
              });
              
              input.addEventListener('input', function() {
                if (this.value.trim()) {
                  this.style.borderColor = '#4CAF50';
                }
              });
            });
          </script>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Error creating checkout:', error.message);
    console.error('Error status:', error.response?.status);
    console.error('Error details:', error.response?.data);
    
    res.status(500).send(`
      <html>
        <head><title>Error de Pago</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>Ha ocurrido un error</h1>
          <p>No pudimos iniciar el pago. Por favor, inténtalo de nuevo.</p>
          <p style="color: #666; font-size: 14px;">${error.message}</p>
          <p style="color: #999; font-size: 12px;">${JSON.stringify(error.response?.data || {})}</p>
          ${return_url ? `<a href="${return_url}" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #000; color: #fff; text-decoration: none; border-radius: 5px;">Volver a la tienda</a>` : ''}
        </body>
      </html>
    `);
  }
});


// Payment success pagina
app.get('/payment/success', (req, res) => {
  const { checkout_id } = req.query;
  
  res.send(`
    <html>
      <head>
        <title>Pago Exitoso</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 50px;
            background: #f5f5f5;
          }
          .success-box {
            background: white;
            padding: 40px;
            border-radius: 10px;
            max-width: 500px;
            margin: 0 auto;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .checkmark {
            color: #4CAF50;
            font-size: 60px;
          }
          h1 { color: #333; }
          p { color: #666; line-height: 1.6; }
          .button {
            display: inline-block;
            margin-top: 20px;
            padding: 12px 30px;
            background: #4CAF50;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="success-box">
          <div class="checkmark">✓</div>
          <h1>¡Pago Exitoso!</h1>
          <p>Tu pago ha sido procesado con éxito.</p>
          <p>Recibirás un correo de confirmación en breve.</p>
          ${checkout_id ? `<p style="font-size: 12px; color: #999;">ID de pago: ${checkout_id}</p>` : ''}
          <a href="#" class="button" onclick="window.close()">Cerrar</a>
        </div>
      </body>
    </html>
  `);
});

// Payment failure pagina
app.get('/payment/failure', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Pago Fallido</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 50px;
            background: #f5f5f5;
          }
          .error-box {
            background: white;
            padding: 40px;
            border-radius: 10px;
            max-width: 500px;
            margin: 0 auto;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .cross {
            color: #f44336;
            font-size: 60px;
          }
          h1 { color: #333; }
          p { color: #666; line-height: 1.6; }
          .button {
            display: inline-block;
            margin-top: 20px;
            padding: 12px 30px;
            background: #000;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="error-box">
          <div class="cross">✗</div>
          <h1>Pago Fallido</h1>
          <p>Tu pago no pudo ser procesado.</p>
          <p>Por favor, inténtalo de nuevo o elige otro método de pago.</p>
          <a href="#" class="button" onclick="window.history.back()">Intentar de Nuevo</a>
        </div>
      </body>
    </html>
  `);
});

// Webhook endpoint for SumUp payment status
app.post('/webhook/sumup', async (req, res) => {
  try {
    const notification = req.body;
    console.log('SumUp webhook received:', notification);
    
    // Hier kan je de Shopify order updaten als de betaling is gelukt
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});

// Get SumUp transactions
app.get('/transactions', async (req, res) => {
  try {
    const response = await axios.get(`${SUMUP_BASE_URL}/me/transactions`, {
      headers: {
        'Authorization': `Bearer ${SUMUP_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    res.json({
      status: 'success',
      transactions: response.data
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`SumUp API configured: ${SUMUP_API_KEY ? 'Yes' : 'No'}`);
  console.log(`Checkout URL: ${APP_URL}/checkout`);
});
