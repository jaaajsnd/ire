# Shopify + SumUp Payment Gateway Setup

## Hoe het werkt:

1. Klant voegt product toe aan winkelwagen (bijv. €20)
2. Klant gaat naar checkout
3. Klant kiest "SumUp" als betaalmethode
4. Klant wordt doorgestuurd naar jouw Render app
5. App maakt een SumUp checkout aan met het juiste bedrag
6. Klant betaalt via SumUp
7. Klant komt terug naar Shopify

---

## STAP 1: Deploy naar Render

### 1.1 Upload naar GitHub (optioneel maar handig)
- Maak een nieuwe repository op GitHub
- Upload alle bestanden uit deze zip
- Kopieer de repository URL

### 1.2 Deploy op Render
1. Ga naar https://render.com en log in
2. Klik op **"New +"** → **"Web Service"**
3. Verbind je GitHub repository OF kies "Deploy from Git"
4. Vul in:
   - **Name**: `shopify-sumup-gateway` (of eigen naam)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

### 1.3 Environment Variables toevoegen
Ga naar **"Environment"** tab en voeg toe:

```
SUMUP_API_KEY = sup_sk_aHVDcfzGttbknB2ePBdJh1IED2PWvpIYA
SUMUP_CLIENT_ID = cc_classic_TxR2AIPeNK5BR84yjWngdUn8Pa0Nj
APP_URL = https://jouw-app-naam.onrender.com
```

**BELANGRIJK**: Vervang `jouw-app-naam.onrender.com` met je echte Render URL!

### 1.4 Deploy
- Klik **"Create Web Service"**
- Wacht 2-5 minuten tot deployment klaar is
- Test je app op: `https://jouw-app.onrender.com/test-sumup`

---

## STAP 2: Test de Payment Gateway

Test of alles werkt door naar deze URL te gaan:

```
https://jouw-app.onrender.com/checkout?amount=20&currency=EUR&order_id=TEST123
```

Je zou nu doorgestuurd moeten worden naar SumUp om €20 te betalen.

---

## STAP 3: Shopify Checkout Aanpassen

Nu moeten we Shopify vertellen om klanten naar jouw gateway te sturen.

### Optie A: Via Shopify Additional Scripts (Premium vereist)

1. Ga naar **Shopify Admin**
2. **Settings** → **Checkout**
3. Scroll naar **Order status page** → **Additional scripts**
4. Plak deze code:

```html
<script>
  // Redirect naar SumUp checkout
  if (window.Shopify && Shopify.checkout) {
    const checkout = Shopify.checkout;
    const amount = checkout.total_price;
    const currency = checkout.currency;
    const orderId = checkout.order_id || checkout.token;
    
    // Jouw Render app URL
    const gatewayUrl = 'https://jouw-app.onrender.com/checkout';
    const checkoutUrl = `${gatewayUrl}?amount=${amount}&currency=${currency}&order_id=${orderId}`;
    
    // Voeg SumUp betaalknop toe
    const paymentSection = document.querySelector('.payment-methods');
    if (paymentSection) {
      const sumupButton = document.createElement('button');
      sumupButton.innerHTML = 'Betaal met SumUp';
      sumupButton.className = 'btn btn-primary';
      sumupButton.onclick = () => window.location.href = checkoutUrl;
      paymentSection.appendChild(sumupButton);
    }
  }
</script>
```

**BELANGRIJK**: Vervang `jouw-app.onrender.com` met je echte URL!

### Optie B: Via Custom Checkout Link (Voor alle Shopify plans)

Voeg een link toe op je product pagina's:

1. **Shopify Admin** → **Online Store** → **Themes**
2. Klik **"Customize"**
3. Ga naar een product pagina
4. Voeg een **Custom HTML** block toe met:

```html
<a href="https://jouw-app.onrender.com/checkout?amount={{ product.price | money_without_currency }}&currency={{ shop.currency }}&order_id={{ product.id }}" 
   class="button button--primary" 
   style="display: block; text-align: center; margin-top: 10px;">
  Koop nu met SumUp
</a>
```

### Optie C: Via Manual Payment Method

1. **Shopify Admin** → **Settings** → **Payments**
2. Scroll naar **Manual payment methods**
3. Klik **"Add manual payment method"**
4. Selecteer **"Create custom payment method"**
5. Vul in:
   - **Custom payment method name**: `SumUp`
   - **Payment instructions**: 
   ```
   Klik op de link om via SumUp te betalen:
   https://jouw-app.onrender.com/checkout
   ```

---

## STAP 4: Test de Complete Flow

1. Ga naar je Shopify store
2. Voeg een product toe aan winkelwagen
3. Ga naar checkout
4. Klik op de SumUp betaaloptie
5. Controleer of je naar SumUp wordt gestuurd met het juiste bedrag
6. Maak een testbetaling (gebruik SumUp test cards)

---

## SumUp Test Cards

Voor testen kan je deze kaarten gebruiken:
- **Success**: `4242 4242 4242 4242`
- **Declined**: `4000 0000 0000 0002`
- CVV: `123`
- Expiry: Elke datum in de toekomst

---

## Endpoints van je App

- `GET /` - Status check
- `GET /health` - Health check  
- `GET /test-sumup` - Test SumUp verbinding
- `GET /checkout` - Main checkout endpoint (hier komen klanten naartoe)
- `GET /payment/success` - Success pagina na betaling
- `GET /payment/failure` - Failure pagina bij mislukte betaling
- `GET /transactions` - Bekijk SumUp transacties

---

## Voorbeeld URLs

### Checkout met parameters:
```
https://jouw-app.onrender.com/checkout?amount=20&currency=EUR&order_id=1234&return_url=https://jouw-shop.com/thank-you
```

Parameters:
- `amount` - Bedrag (bijv. 20 of 20.50)
- `currency` - Valuta (EUR, USD, etc.)
- `order_id` - Shopify order ID (optioneel)
- `return_url` - Waar klant naartoe gaat na betaling (optioneel)

---

## Problemen oplossen

### "Cannot create checkout" error
- Check of je API keys correct zijn in Render Environment Variables
- Test de verbinding op `/test-sumup`

### Klant komt niet terug naar Shopify
- Zorg dat je `return_url` parameter meegeeft in de checkout URL

### Betaling werkt niet
- Check of je SumUp account geactiveerd is
- Kijk in de Render logs voor errors (Dashboard → Logs)

---

## Support

- SumUp API docs: https://developer.sumup.com
- Shopify checkout docs: https://shopify.dev/docs/api/checkout-ui-extensions
- Render docs: https://render.com/docs
