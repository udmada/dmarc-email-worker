# DMARC Email Worker - Deployment Guide

## Production-Ready Refactored Implementation

This worker processes DMARC and TLS-RPT email reports with enterprise-grade features:

- ✅ **temperror handling** - Separate counters for DKIM/SPF temporary errors
- ✅ **RFC 8460 TLS-RPT** - Full JSON parsing with kebab-case field names
- ✅ **Delayed replies** - (Optional, Free tier) Acknowledgment via Durable Object Alarms (1hr delay)
- ✅ **Multi-database** - Analytics Engine + D1 + PostgreSQL (via Hyperdrive)
- ✅ **Performance** - Single decompression per attachment
- ✅ **Null safety** - Defensive programming for optional fields
- ✅ **Security** - Domain whitelist + DMARC validation + rate limiting

---

## Prerequisites

1. **Cloudflare Account** with Workers enabled
2. **Wrangler CLI** installed (`npm install -g wrangler`)
3. **Node.js** 18+ and npm

---

## Step 1: Install Dependencies

```bash
npm install
```

This installs:

- `postal-mime` - Email parsing
- `fast-xml-parser` - DMARC XML parsing
- `pako` - Gzip decompression
- `mimetext` - Email composition for replies
- `postgres` - PostgreSQL client (for Hyperdrive)

---

## Step 2: Create D1 Database

```bash
# Create the database
wrangler d1 create dmarc_reports

# Copy the database_id from the output and update wrangler.toml
# Replace YOUR_D1_DATABASE_ID with the actual ID

# Create schema
wrangler d1 execute dmarc_reports --file=schema.sql
```

---

## Step 3: (Optional) Enable Reply Emails via Durable Object Alarms

When enabled, the worker sends acknowledgment emails 1 hour after processing a DMARC report using a Durable Object with Alarms (free tier).

```bash
# Uncomment the [durable_objects], [[migrations]],
# and [[send_email]] sections in wrangler.toml
```

---

## Step 4: Configure Email Routing

1. Go to **Cloudflare Dashboard** → **Email Routing**
2. Add a destination address (e.g., `dmarc@yourdomain.com`)
3. Configure routing rules to forward DMARC/TLS-RPT emails to your worker

---

## Step 5: Configure Rate Limiting

The rate limiting binding is configured in `wrangler.toml`. It limits to 100 emails per minute per sender domain.

---

## Step 6: (Optional) Set Up Hyperdrive for PostgreSQL

If you want to use PostgreSQL for long-term storage:

```bash
# Create Hyperdrive connection
wrangler hyperdrive create dmarc-postgres --connection-string="postgres://user:password@host:5432/database"

# Uncomment the [[hyperdrive]] section in wrangler.toml
# Replace YOUR_HYPERDRIVE_ID with the ID from the output

# Create PostgreSQL schema
psql -f schema.postgres.sql
```

---

## Step 7: Update Configuration

Edit `src/index.ts` and replace:

1. **Line 290-291**: Change `reports@yourdomain.com` to your actual sender email
2. **Line 293**: Change `yourdomain.com` to your actual domain
3. **Line 303**: Change report URL to your actual reporting dashboard

Edit `wrangler.toml`:

1. Replace `YOUR_D1_DATABASE_ID` with your D1 database ID
2. (Optional) Uncomment and configure Hyperdrive section
3. Update `TRUSTED_REPORTERS` set in `src/index.ts:59-62` if needed

---

## Step 8: Test Locally

```bash
# Start local development server
wrangler dev
```

Send a test email with a DMARC report attachment to verify processing.

---

## Step 9: Deploy to Production

```bash
# Deploy the worker
wrangler deploy
```

---

## Step 10: Monitor and Verify

1. **Analytics Engine**: Query with GraphQL API

   ```graphql
   query {
     viewer {
       accounts(filter: { accountTag: "YOUR_ACCOUNT_ID" }) {
         dmarcAnalytics: analyticsEngineDatasets(filter: { datasetId: "dmarc_reports" }) {
           nodes {
             dimensions {
               blob1
               blob2
               blob3
             }
             metrics {
               double1
               double2
               double3
             }
           }
         }
       }
     }
   }
   ```

2. **D1 Database**: Query reports

   ```bash
   wrangler d1 execute dmarc_reports --command="SELECT * FROM dmarc_reports LIMIT 10"
   ```

3. **Reply DO**: Check worker logs for reply processing
   ```bash
   wrangler tail
   ```

---

## Security Configuration

### Trusted Reporter Domains

The worker only accepts reports from trusted domains (src/index.ts:59-62):

```typescript
const TRUSTED_REPORTERS = new Set([
  "google.com",
  "microsoft.com",
  "yahoo.com",
  "amazon.com",
  "proofpoint.com",
  "dmarcian.com",
  "postmarkapp.com",
  "sendgrid.net",
]);
```

Add or remove domains based on your requirements.

### DMARC Validation

The worker validates that incoming emails pass DMARC checks (src/index.ts:94-98).

### Rate Limiting

Configured to 100 emails/minute per sender domain. Adjust in `wrangler.toml:30`.

---

## Database Schema

### D1 Tables

- **dmarc_reports**: Stores DMARC report metadata and authentication results
  - Tracks DKIM/SPF pass/fail/temperror counts separately
  - Stores raw XML for debugging

- **tls_reports**: Stores TLS-RPT policy evaluation results
  - RFC 8460 compliant
  - JSON storage for failure details

### PostgreSQL Tables (Optional)

Same schema as D1 but with:

- TIMESTAMP types instead of INTEGER
- JSONB for failure_details
- Advanced composite indexes

---

## Reply Queue Processing (Optional)

When the Durable Object and SendEmail bindings are configured (free tier), the worker sends acknowledgment emails 1 hour after processing using:

- Durable Object Alarms for delayed scheduling
- In-Reply-To header for threading
- References header for proper email client display
- Unique Message-ID generation
- Automatic retry with exponential backoff (max 5 attempts)

If `REPLY_QUEUE` or `EMAIL` bindings are not configured, reply emails are silently skipped.

Customize the reply template in `sendReply()` in `src/reply.ts`.

---

## Troubleshooting

### Issue: No data in Analytics Engine

- Check that `ANALYTICS` binding is correct
- Verify dataset name matches in wrangler.toml

### Issue: Reply emails not sending

- Verify `REPLY_QUEUE` DO binding is uncommented in wrangler.toml
- Verify `EMAIL` send_email binding is uncommented
- Check worker logs: `wrangler tail`

### Issue: PostgreSQL connection fails

- Verify Hyperdrive connection string
- Check network access to PostgreSQL instance
- Ensure schema is created

### Issue: Rate limit too strict

- Adjust `simple.limit` in wrangler.toml
- Consider per-IP rate limiting instead of per-domain

---

## Performance Optimization

1. **Single decompression**: Each attachment is decompressed once and type-detected (src/index.ts:145-166)
2. **Parallel storage**: Analytics, D1, and PostgreSQL writes happen concurrently (src/index.ts:310-315)
3. **Connection pooling**: Hyperdrive singleton pattern (src/index.ts:69-74)
4. **Null safety**: Defensive checks prevent crashes (src/index.ts:251)

---

## Next Steps

1. Build a dashboard to visualize DMARC reports from D1/PostgreSQL
2. Set up alerts for DMARC failures
3. Configure DNS records based on report insights
4. Implement SPF/DKIM failure analysis
5. Add TLS-RPT policy recommendations

---

## Support

For issues or questions:

- Review worker logs: `wrangler tail`
- Check Cloudflare Dashboard for error rates
- Verify email routing configuration
- Test with sample DMARC reports from major providers

---

**Status**: Production-ready for deployment ✅
