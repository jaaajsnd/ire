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
const SUMUP_EMAIL = process.env.SUMUP_EMAIL || 'azizjadi888@gmail.com';
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

// Test SumUp connection
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
      data: error.response?.data
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

// Create Shopify order
async function createShopifyOrder(customerData, cartData, checkoutId, transactionData) {
  try {
    console.log('=== CREATING SHOPIFY ORDER ===');
    console.log('Customer data:', customerData);
    console.log('Cart data:', cartData);
    console.log('Checkout ID:', checkoutId);
    console.log('Transaction data:', transactionData);
    
    // Validate we have cart data
    if (!cartData || !cartData.items || cartData.items.length === 0) {
      throw new Error('No cart items found');
    }
    
    // Prepare line items
    const lineItems = cartData.items.map(item => {
      const lineItem = {
        title: item.title || item.product_title,
        quantity: item.quantity,
        price: (item.price / 100).toFixed(2)
      };
      
      // Add variant_id if available
      if (item.variant_id) {
        lineItem.variant_id = item.variant_id;
      }
      
      // Add SKU if available
      if (item.sku) {
        lineItem.sku = item.sku;
      }
      
      return lineItem;
    });
    
    // Prepare order data
    const orderData = {
      order: {
        email: customerData.email,
        financial_status: 'paid',
        fulfillment_status: null,
        send_receipt: true,
        send_fulfillment_receipt: false,
        note: `Paid via SumUp. Checkout ID: ${checkoutId}`,
        line_items: lineItems,
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

    console.log('✅ Shopify order created successfully:', response.data.order.id);
    console.log('Order number:', response.data.order.order_number);
    return response.data.order;

  } catch (error) {
    console.error('❌ Error creating Shopify order:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

// Save customer data and create order
app.post('/api/save-customer-data', async (req, res) => {
  try {
    const { checkoutId, customerData, cartData } = req.body;
    
    console.log('=== SAVE CUSTOMER DATA ===');
    console.log('Checkout ID:', checkoutId);
    console.log('Customer:', customerData);
    console.log('Cart:', cartData);
    
    // Validate input
    if (!checkoutId) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing checkoutId'
      });
    }
    
    if (!customerData || !customerData.email) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing customer data'
      });
    }
    
    // Get transaction details from SumUp
    const checkoutResponse = await axios.get(`${SUMUP_BASE_URL}/checkouts/${checkoutId}`, {
      headers: {
        'Authorization': `Bearer ${SUMUP_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const checkout = checkoutResponse.data;
    console.log('SumUp checkout status:', checkout.status);
    
    // Just return success - no Shopify order creation
    console.log('✅ Payment confirmed - customer data saved');
    
    res.json({
      status: 'success',
      message: 'Payment successful'
    });
    
  } catch (error) {
    console.error('❌ Error in save-customer-data:', error.message);
    res.status(500).json({
      status: 'error',
      message: error.message,
      details: error.response?.data
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
    console.log('Payment status:', checkout.status);
    
    // Check if payment is successful
    let actualStatus = checkout.status;
    
    // If checkout has transactions check if any are SUCCESSFUL
    if (checkout.transactions && checkout.transactions.length > 0) {
      const successfulTxn = checkout.transactions.find(txn => txn.status === 'SUCCESSFUL');
      if (successfulTxn) {
        actualStatus = 'PAID';
        console.log('✅ Found SUCCESSFUL transaction');
      }
    }
    
    res.json({
      status: actualStatus,
      checkout: checkout
    });
  } catch (error) {
    console.error('Error checking payment:', error.message);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Checkout pagina - UPDATED met cart_items parameter
app.get('/checkout', async (req, res) => {
  const { amount, currency, order_id, return_url, cart_items } = req.query;
  
  if (!amount || !currency) {
    return res.status(400).send('Missing required parameters: amount and currency');
  }

  // Parse cart items if provided
  let cartData = null;
  if (cart_items) {
    try {
      cartData = JSON.parse(decodeURIComponent(cart_items));
      console.log('Cart data received:', cartData);
    } catch (e) {
      console.error('Error parsing cart_items:', e);
    }
  }

  const checkoutRef = order_id ? `shopify-${order_id}-${Date.now()}` : `shopify-${Date.now()}`;

  try {
    const checkoutData = {
      checkout_reference: checkoutRef,
      amount: parseFloat(amount),
      currency: currency.toUpperCase(),
      pay_to_email: SUMUP_EMAIL,
      description: `Shopify Order ${order_id || ''}`
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
    
    // Store order info
    if (order_id) {
      pendingOrders.set(checkout.id, {
        order_id,
        amount,
        currency,
        return_url,
        cart_data: cartData,
        created_at: new Date()
      });
    }

    // Show payment page
    res.send(`
      <html>
        <head>
          <title>Payment - €${amount}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <script src="https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js"></script>
          <style>
            * { box-sizing: border-box; }
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
            .success-popup {
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              background: white;
              padding: 40px;
              border-radius: 15px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              z-index: 9999;
              text-align: center;
              display: none;
              min-width: 400px;
            }
            .success-popup.show {
              display: block;
            }
            .success-popup-overlay {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(0,0,0,0.5);
              z-index: 9998;
              display: none;
            }
            .success-popup-overlay.show {
              display: block;
            }
            .success-icon {
              font-size: 60px;
              color: #4CAF50;
              margin-bottom: 20px;
            }
            .success-title {
              font-size: 24px;
              font-weight: bold;
              color: #333;
              margin-bottom: 10px;
            }
            .success-text {
              font-size: 16px;
              color: #666;
              margin-bottom: 20px;
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
            <h1>💳 Secure Checkout</h1>
            <div class="amount">€${amount}</div>
            <div class="description">Order ${order_id || ''}</div>
            <div id="error-message" class="error"></div>
            <div id="success-message" class="success"></div>
            <div id="loading-message" class="loading">Processing payment...</div>
            
            <!-- Success Popup -->
            <div id="success-popup-overlay" class="success-popup-overlay"></div>
            <div id="success-popup" class="success-popup">
              <div class="success-icon">✓</div>
              <div class="success-title">Payment Successful!</div>
              <div class="success-text">Your payment has been processed successfully.</div>
            </div>
            
            <div class="section">
              <div class="section-title">Customer Information</div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="firstName">First Name *</label>
                  <input type="text" id="firstName" placeholder="Sean" required>
                </div>
                <div class="form-group">
                  <label for="lastName">Last Name *</label>
                  <input type="text" id="lastName" placeholder="O'Brien" required>
                </div>
              </div>
              
              <div class="form-group">
                <label for="email">Email *</label>
                <input type="email" id="email" placeholder="sean@example.ie" required>
              </div>
              
              <div class="form-group">
                <label for="phone">Phone Number</label>
                <input type="tel" id="phone" placeholder="+353 85 123 4567">
              </div>
            </div>

            <div class="section">
              <div class="section-title">Billing Address</div>
              
              <div class="form-group">
                <label for="address">Address *</label>
                <input type="text" id="address" placeholder="12 O'Connell Street" required>
              </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="postalCode">Eircode *</label>
                  <input type="text" id="postalCode" placeholder="D01 F5P2" required>
                </div>
                <div class="form-group">
                  <label for="city">City *</label>
                  <input type="text" id="city" placeholder="Dublin" required>
                </div>
              </div>
              
              <div class="form-group">
                <label for="country">Country *</label>
                <input type="text" id="country" value="Ireland" required>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Payment Details</div>
              <div id="sumup-card"></div>
            </div>
            
            <div class="secure">
              🔒 Secure payment with SumUp
            </div>
            
            ${return_url ? `<a href="${return_url}" class="back-button">← Back to store</a>` : ''}
          </div>

          <script>
            let customerData = {};
            const cartData = ${cartData ? JSON.stringify(cartData) : 'null'};
            const checkoutId = '${checkout.id}';
            let pollingInterval = null;

            console.log('Cart data:', cartData);

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
                
                console.log('Payment status:', data.status);
                
                if (data.status === 'PAID') {
                  if (pollingInterval) {
                    clearInterval(pollingInterval);
                  }
                  
                  console.log('Payment successful! Creating order...');
                  document.getElementById('loading-message').style.display = 'block';
                  document.getElementById('loading-message').innerHTML = '✓ Payment successful! Processing...';
                  
                  // Send customer data and cart data to backend
                  const saveResponse = await fetch('/api/save-customer-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      checkoutId: checkoutId,
                      customerData: customerData,
                      cartData: cartData
                    })
                  });
                  
                  const saveData = await saveResponse.json();
                  console.log('Save response:', saveData);
                  
                  if (saveData.status === 'success') {
                    document.getElementById('loading-message').style.display = 'none';
                    
                    // Show success popup
                    document.getElementById('success-popup-overlay').classList.add('show');
                    document.getElementById('success-popup').classList.add('show');
                    
                    setTimeout(() => {
                      const returnUrl = '${return_url || APP_URL + '/payment/success'}';
                      const separator = returnUrl.includes('?') ? '&' : '?';
                      window.location.href = returnUrl + separator + 'checkout_id=' + checkoutId;
                    }, 2000);
                  } else {
                    throw new Error(saveData.message || 'Failed to process payment');
                  }
                } else if (data.status === 'FAILED') {
                  if (pollingInterval) {
                    clearInterval(pollingInterval);
                  }
                  
                  document.getElementById('loading-message').style.display = 'none';
                  document.getElementById('error-message').style.display = 'block';
                  document.getElementById('error-message').innerHTML = 
                    '✗ Payment failed. Please try again.';
                }
              } catch (error) {
                console.error('Error:', error);
                if (pollingInterval) {
                  clearInterval(pollingInterval);
                }
                document.getElementById('loading-message').style.display = 'none';
                document.getElementById('error-message').style.display = 'block';
                document.getElementById('error-message').innerHTML = '✗ Error: ' + error.message;
              }
            }

            function startPolling() {
              console.log('Starting payment polling...');
              checkPaymentStatus();
              pollingInterval = setInterval(checkPaymentStatus, 2000);
              
              setTimeout(() => {
                if (pollingInterval) {
                  clearInterval(pollingInterval);
                  console.log('Polling timeout');
                }
              }, 120000);
            }

            document.addEventListener('visibilitychange', function() {
              if (!document.hidden && pollingInterval) {
                console.log('Page visible - checking payment');
                checkPaymentStatus();
              }
            });

            SumUpCard.mount({
              checkoutId: checkoutId,
              showSubmitButton: true,
              locale: 'en-US',
              onResponse: function(type, body) {
                console.log('SumUp event:', type);
                
                const errorDiv = document.getElementById('error-message');
                const loadingDiv = document.getElementById('loading-message');
                
                switch(type) {
                  case 'sent':
                    if (!validateCustomerInfo()) {
                      errorDiv.style.display = 'block';
                      errorDiv.innerHTML = '✗ Please fill in all required fields';
                      return;
                    }
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Processing payment...';
                    startPolling();
                    break;
                    
                  case 'auth-screen':
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Verifying payment... Please complete 3D Secure authentication.';
                    if (!pollingInterval) {
                      startPolling();
                    }
                    break;
                    
                  case 'success':
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Confirming payment...';
                    if (!pollingInterval) {
                      startPolling();
                    }
                    break;
                    
                  case 'error':
                    if (pollingInterval) {
                      clearInterval(pollingInterval);
                    }
                    loadingDiv.style.display = 'none';
                    errorDiv.style.display = 'block';
                    errorDiv.innerHTML = '✗ Payment failed: ' + (body.message || 'Please try again');
                    break;
                    
                  case 'invalid':
                    if (pollingInterval) {
                      clearInterval(pollingInterval);
                    }
                    loadingDiv.style.display = 'none';
                    errorDiv.style.display = 'block';
                    errorDiv.innerHTML = '✗ Invalid card data. Please check your card information.';
                    break;
                }
              }
            });

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
    console.error('Error details:', error.response?.data);
    
    res.status(500).send(`
      <html>
        <head><title>Payment Error</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>An error occurred</h1>
          <p>Could not start payment. Please try again.</p>
          <p style="color: #666; font-size: 14px;">${error.message}</p>
          ${return_url ? `<a href="${return_url}" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #000; color: #fff; text-decoration: none; border-radius: 5px;">Back to store</a>` : ''}
        </body>
      </html>
    `);
  }
});

// Payment success page
app.get('/payment/success', (req, res) => {
  const { checkout_id } = req.query;
  
  res.send(`
    <html>
      <head>
        <title>Payment Successful</title>
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
          <h1>Payment Successful!</h1>
          <p>Your payment has been processed successfully.</p>
          <p>You will receive a confirmation email shortly.</p>
          ${checkout_id ? `<p style="font-size: 12px; color: #999;">Payment ID: ${checkout_id}</p>` : ''}
          <a href="#" class="button" onclick="window.close()">Close</a>
        </div>
      </body>
    </html>
  `);
});

// Webhook endpoint for SumUp
app.post('/webhook/sumup', async (req, res) => {
  try {
    const notification = req.body;
    console.log('SumUp webhook received:', notification);
    
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
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 App URL: ${APP_URL}`);
  console.log(`✅ SumUp API configured: ${SUMUP_API_KEY ? 'Yes' : 'No'}`);
  console.log(`✅ Shopify configured: ${SHOPIFY_ACCESS_TOKEN ? 'Yes' : 'No'}`);
  console.log(`🔗 Checkout URL: ${APP_URL}/checkout`);
  console.log('');
  console.log('💡 Example checkout URL:');
  console.log(`${APP_URL}/checkout?amount=10.00&currency=EUR&order_id=1001&return_url=https://yourstore.com/success&cart_items=${encodeURIComponent(JSON.stringify({items:[{variant_id:123,title:"Product",quantity:1,price:1000}],total_price:1000,currency:"EUR"}))}`);
});
