# Morning Integration

## Environment variables

- `MORNING_API_BASE_URL`
- `MORNING_AUTH_BASE_URL`
- `MORNING_API_KEY_ID`
- `MORNING_API_KEY_SECRET`
- `MORNING_SANDBOX`

Keep all Morning secrets server-side only. Never expose them in client components.

## 2026 API migration

- The production resource base should resolve to `https://api.greeninvoice.co.il/api/v1`.
- If an environment still contains legacy Green Invoice URLs such as `https://www.greeninvoice.co.il/api` or `https://api.greeninvoice.co.il/api`, BizManager now normalizes them automatically to the supported host.
- Token requests are sent to `https://api.morning.co/idp/v1/oauth/token` in standard OAuth form-encoded format, with a JSON fallback for compatibility while Morning completes the transition.

## Source of truth

BizManager remains the source of truth for:

- customers
- orders
- projects
- payments
- inventory
- delivery
- tasks
- profitability

Morning is used only as the official billing/document system.

## Customer matching flow

1. Open `/settings/integrations/morning/customers`
2. Click `ייבוא / התאמת לקוחות Morning`
3. BizManager fetches Morning clients and scores matches by:
   - exact tax/registration id
   - exact email
   - normalized phone
   - strong normalized name match
4. If there is one strong result, it can be linked safely.
5. If there are multiple or weak results, review manually.
6. BizManager does not overwrite local customer fields automatically.

## Document type mapping

- `10` = quote / הצעת מחיר
- `305` = tax invoice / חשבונית מס
- `400` = receipt / קבלה
- `320` = tax invoice receipt / חשבונית מס-קבלה

## Duplicate rules

- Receipts are blocked for the same payment unless an admin explicitly overrides.
- Invoices are blocked for the same order/project unless an admin explicitly overrides.
- Quotes can be issued multiple times.

## Local tracking

- `morning_documents` stores official Morning metadata.
- `documents` and `document_links` keep the local archive links for the returned PDF/link.
- Customer pages, order details, project details, and payment rows should read local Morning metadata from `morning_documents`, not directly from Morning.

## Safe testing

1. Use a Morning sandbox account where possible.
2. Start by issuing quotes before invoices/receipts.
3. Verify customer matching on one test customer before bulk linking.
4. Check that duplicate protection blocks a second receipt for the same payment.

## API key creation

Create the API key inside Morning’s API/integration settings and store the values only in the server environment.
