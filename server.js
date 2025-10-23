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
    console.log('Checkout status:', checkout.status);
    
    res.json({
      status: checkout.status,
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

// Checkout pagina - hier komt de klant naartoe vanaf Shopify
app.get('/checkout', async (req, res) => {
  const { amount, currency, order_id, return_url } = req.query;
  
  if (!amount || !currency) {
    return res.status(400).send('Missing required parameters: amount and currency');
  }

  // Add timestamp to make each attempt unique (only if order_id exists)
  const checkoutRef = order_id ? `shopify-${order_id}-${Date.now()}` : `shopify-${Date.now()}`;

  try {
    const checkoutData = {
      checkout_reference: checkoutRef,
      amount: parseFloat(amount),
      currency: currency.toUpperCase(),
      pay_to_email: 'yurkovsergii@gmail.com',
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
    
    // Sla order info op
    if (order_id) {
      pendingOrders.set(checkout.id, {
        order_id,
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
          <title>Checkout - € ${amount}</title>
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
            <h1>🛒 Checkout</h1>
            <div class="amount">€ ${amount}</div>
            <div class="description">Order ${order_id || ''}</div>
            
            <div id="error-message" class="error"></div>
            <div id="success-message" class="success"></div>
            <div id="loading-message" class="loading">Processing payment...</div>
            
            <!-- Customer Details Section -->
            <div class="section">
              <div class="section-title">Customer Information</div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="firstName">First Name *</label>
                  <input type="text" id="firstName" placeholder="John" required>
                </div>
                <div class="form-group">
                  <label for="lastName">Last Name *</label>
                  <input type="text" id="lastName" placeholder="Murphy" required>
                </div>
              </div>
              
              <div class="form-group">
                <label for="email">Email Address *</label>
                <input type="email" id="email" placeholder="john@example.com" required>
              </div>
              
              <div class="form-group">
                <label for="phone">Phone Number</label>
                <input type="tel" id="phone" placeholder="+353 87 123 4567">
              </div>
            </div>

            <!-- Billing Address Section -->
            <div class="section">
              <div class="section-title">Billing Address</div>
              
              <div class="form-group">
                <label for="address">Street Address *</label>
                <input type="text" id="address" placeholder="123 O'Connell Street" required>
              </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="postalCode">Postal Code *</label>
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

            <!-- Payment Section -->
            <div class="section">
              <div class="section-title">Payment Details</div>
              <div id="sumup-card"></div>
            </div>
            
            <div class="secure">
              🔒 Secure payment powered by SumUp
            </div>
            
            ${return_url ? `<a href="${return_url}" class="back-button">← Back to store</a>` : ''}
          </div>

          <script>
            // Store customer data when payment is successful
            let customerData = {};
            const checkoutId = '${checkout.id}';
            let pollingInterval = null;

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
                  
                  document.getElementById('loading-message').style.display = 'none';
                  document.getElementById('success-message').style.display = 'block';
                  document.getElementById('success-message').innerHTML = '✓ Payment successful! Redirecting...';
                  
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
                  
                  document.getElementById('loading-message').style.display = 'none';
                  document.getElementById('error-message').style.display = 'block';
                  document.getElementById('error-message').innerHTML = '✗ Payment failed. Please try again.';
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

            // Initialize SumUp Card Widget
            SumUpCard.mount({
              checkoutId: checkoutId,
              showSubmitButton: true,
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
                      errorDiv.innerHTML = '✗ Please fill in all required fields';
                      return;
                    }
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Processing payment...';
                    break;
                    
                  case 'auth-screen':
                    console.log('3DS authentication screen shown');
                    // 3DS authentication in progress
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Verifying payment... Please complete 3D Secure authentication.';
                    // Start polling for payment status
                    startPolling();
                    break;
                    
                  case 'success':
                    console.log('Widget reported success');
                    loadingDiv.style.display = 'block';
                    loadingDiv.innerHTML = 'Confirming payment...';
                    
                    // Save customer data
                    console.log('Customer data:', customerData);
                    
                    // Start polling for payment status
                    startPolling();
                    break;
                    
                  case 'error':
                    console.log('Widget reported error:', body);
                    if (pollingInterval) {
                      clearInterval(pollingInterval);
                    }
                    loadingDiv.style.display = 'none';
                    errorDiv.style.display = 'block';
                    errorDiv.innerHTML = '✗ Payment failed: ' + (body.message || 'Please try again');
                    break;
                    
                  case 'invalid':
                    console.log('Widget reported invalid data');
                    if (pollingInterval) {
                      clearInterval(pollingInterval);
                    }
                    loadingDiv.style.display = 'none';
                    errorDiv.style.display = 'block';
                    errorDiv.innerHTML = '✗ Invalid payment details. Please check your card information.';
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
        <head><title>Payment Error</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>An error occurred</h1>
          <p>We could not start the payment. Please try again.</p>
          <p style="color: #666; font-size: 14px;">${error.message}</p>
          <p style="color: #999; font-size: 12px;">${JSON.stringify(error.response?.data || {})}</p>
          ${return_url ? `<a href="${return_url}" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #000; color: #fff; text-decoration: none; border-radius: 5px;">Back to store</a>` : ''}
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
          ${checkout_id ? `<p style="font-size: 12px; color: #999;">Checkout ID: ${checkout_id}</p>` : ''}
          <a href="#" class="button" onclick="window.close()">Close</a>
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
        <title>Payment Failed</title>
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
          <h1>Payment Failed</h1>
          <p>Your payment could not be processed.</p>
          <p>Please try again or choose a different payment method.</p>
          <a href="#" class="button" onclick="window.h
