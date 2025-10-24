# Shopify-SumUp Integration via Render

Deze applicatie verbindt Shopify met SumUp voor betalingsverwerking.

## Stap 1: Deploy naar Render

1. Ga naar https://render.com en log in
2. Klik op "New +" en kies "Web Service"
3. Kies een deployment methode:
   - Upload deze code naar GitHub en verbind de repository
   - Of gebruik de "Deploy from Git" optie

## Stap 2: Render configuratie

Vul de volgende instellingen in:

- **Name**: shopify-sumup-integration
- **Environment**: Node
- **Build Command**: npm install
- **Start Command**: npm start
- **Instance Type**: Free (voor starten)

## Stap 3: Environment Variables toevoegen

Ga naar "Environment" tab in Render en voeg toe:

- **SUMUP_API_KEY**: sup_sk_aHVDcfzGttbknB2ePBdJh1IED2PWvpIYA
- **SUMUP_CLIENT_ID**: cc_classic_TxR2AIPeNK5BR84yjWngdUn8Pa0Nj

## Stap 4: Deploy

Klik op "Create Web Service" en wacht tot de deployment klaar is.

Je krijgt een URL zoals: https://shopify-sumup-integration.onrender.com

## Stap 5: Test de verbinding

Ga naar: https://jouw-app.onrender.com/test-sumup

Als het werkt zie je je SumUp merchant informatie.

## Stap 6: Shopify Webhook instellen

1. Ga naar je Shopify Admin
2. Settings > Notifications > Webhooks
3. Klik "Create webhook"
4. Event: Order creation
5. Format: JSON
6. URL: https://jouw-app.onrender.com/webhook/order-created
7. Webhook API version: 2024-10 (of nieuwste)

## Endpoints

- `GET /` - Status check
- `GET /health` - Health check
- `GET /test-sumup` - Test SumUp verbinding
- `POST /webhook/order-created` - Shopify order webhook
- `GET /transactions` - Bekijk SumUp transacties

## Support

Voor vragen over de SumUp API: https://developer.sumup.com
Voor vragen over Shopify webhooks: https://shopify.dev/docs/api/admin-rest/webhooks
