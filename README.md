# Deal Sniper

A bookmarklet + Cloudflare Worker that finds underpriced electronics on Facebook Marketplace by cross-referencing eBay prices and using AI to filter deals.

## How It Works

1. **Bookmarklet** scrapes visible FB Marketplace listings (title, price, image, URL)
2. **Cloudflare Worker** receives the listings and:
   - Translates Hebrew product names to English (לנובו → Lenovo, דל → Dell, etc.)
   - Filters out non-electronics (furniture, accessories)
   - Searches eBay Browse API for each item's market price
   - Sends candidates priced >15% below eBay median to Claude AI
   - Claude rates deals as STEAL / GREAT / GOOD (everything else is filtered out)
3. Results page shows only deals worth checking, ranked by value

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [eBay Developer account](https://developer.ebay.com) (free, 5000 API calls/day)
- [Anthropic API key](https://console.anthropic.com) (for Claude AI analysis)
- Node.js 18+

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/deal-sniper.git
cd deal-sniper/worker
npm install
```

### 2. Get your API keys

#### eBay Developer Account
1. Go to [developer.ebay.com](https://developer.ebay.com) → sign up
2. Create an application (name it anything, e.g. "deal-sniper")
3. Your keyset will be disabled — click **"apply for an exemption"** under Marketplace Account Deletion
   - Select "I do not persist eBay data"
   - In additional info: "My application uses the Browse API to search public listings for price comparison. It does not store eBay user data."
4. Once approved, copy your **App ID (Client ID)** and **Cert ID (Client Secret)** from the Production keyset

#### Anthropic API Key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key

#### Auth Token
Generate a random token for bookmarklet authentication:
```bash
openssl rand -hex 32
```

### 3. Configure the Worker

```bash
cd worker

# Copy the example env file for local development
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your real keys

# Set production secrets
npx wrangler secret put EBAY_CLIENT_ID
npx wrangler secret put EBAY_CLIENT_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put EBAY_VERIFICATION_TOKEN
```

### 4. Deploy

```bash
npx wrangler deploy
```

Note your worker URL (e.g. `https://deal-sniper.YOUR-SUBDOMAIN.workers.dev`).

### 5. Set up the Bookmarklet

1. Open `bookmarklet/deal-sniper.js`
2. Replace the two config values at the top:
   ```js
   var WORKER_URL = "https://deal-sniper.YOUR-SUBDOMAIN.workers.dev";
   var AUTH_TOKEN = "your-auth-token-from-step-2";
   ```
3. Minify and URL-encode the bookmarklet (use any JS minifier, or paste the whole file into the browser console prefixed with `javascript:`)
4. Create a new bookmark in your browser and paste the encoded bookmarklet as the URL

### 6. Use it

1. Go to [Facebook Marketplace](https://www.facebook.com/marketplace) and set your search filters
2. Click the bookmarklet — a side panel appears
3. Click **Scroll & Scrape** to auto-scroll and collect listings
4. Click **Find Deals** — opens a new tab with results
5. Only STEAL / GREAT / GOOD deals are shown

## Project Structure

```
deal-sniper/
├── bookmarklet/
│   └── deal-sniper.js        # Bookmarklet source (readable)
├── worker/
│   ├── src/
│   │   ├── index.ts           # Main handler, auth, pipeline
│   │   ├── ebay.ts            # eBay OAuth + Browse API + Hebrew translation
│   │   ├── claude.ts          # Claude AI deal analysis
│   │   └── types.ts           # TypeScript interfaces
│   ├── wrangler.toml          # Cloudflare Worker config
│   ├── package.json
│   └── .dev.vars.example      # Template for local dev secrets
├── .gitignore
└── README.md
```

## How Deal Scoring Works

| Tier | Criteria | Description |
|------|----------|-------------|
| STEAL | >60% below market | Absurdly cheap — worth immediate action |
| GREAT | 40-60% below market | Excellent deal |
| GOOD | 25-40% below market | Solid deal, worth checking |

Items below 25% discount, unidentifiable products, and non-electronics are automatically filtered out.

## Hebrew Support

The worker translates common Hebrew brand transliterations before searching eBay:

| Hebrew | English |
|--------|---------|
| לנובו | Lenovo |
| דל | Dell |
| סמסונג | Samsung |
| אפל | Apple |
| מקבוק | MacBook |
| אסוס | Asus |
| מחשב נייד | laptop |
| מחשב גיימינג | gaming PC |
| מסך | monitor |

## API Limits

- **eBay**: 5,000 Browse API calls/day (free tier). Each listing = 1 call. Non-electronics are pre-filtered to save calls.
- **Claude**: Pay-per-use. Uses Haiku (cheapest model). Typically < $0.01 per batch of 30 listings.
- **Cloudflare Worker**: 100,000 requests/day on free tier.

## License

MIT
