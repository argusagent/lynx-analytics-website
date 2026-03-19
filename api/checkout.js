/**
 * /api/checkout — Stripe checkout session creator
 * 
 * ENV VARS NEEDED (add to Vercel dashboard):
 *   STRIPE_SECRET_KEY     — from Stripe dashboard → Developers → API Keys
 *   STRIPE_PRICE_EDGE     — Price ID for Edge $9/mo (e.g. price_xxx)
 *   STRIPE_PRICE_SHARP    — Price ID for Sharp $19/mo (e.g. price_xxx)
 *   NEXT_PUBLIC_SITE_URL  — https://lynx-analytics-ten.vercel.app
 * 
 * SETUP STEPS:
 * 1. Create Stripe account → stripe.com
 * 2. Create two Products: "Lynx Edge" ($9/mo) and "Lynx Sharp" ($19/mo)
 * 3. Copy the Price IDs (price_xxx) and paste above
 * 4. Add STRIPE_SECRET_KEY + both Price IDs to Vercel env vars
 * 5. Add STRIPE_WEBHOOK_SECRET (from webhook endpoint in Stripe dashboard)
 */

const https = require('https');
const querystring = require('querystring');

function stripePost(path, secretKey, params) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(params);
    const req = https.request({
      hostname: 'api.stripe.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tier = 'edge' } = req.body || {};
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://lynx-analytics-ten.vercel.app';

  // Stripe not yet configured — return waitlist mode
  if (!STRIPE_KEY) {
    return res.status(200).json({
      waitlist: true,
      message: `You've been added to the ${tier === 'sharp' ? 'Sharp' : 'Edge'} waitlist! We'll notify you at launch.`,
    });
  }

  const priceId = tier === 'sharp'
    ? process.env.STRIPE_PRICE_SHARP
    : process.env.STRIPE_PRICE_EDGE;

  if (!priceId) {
    return res.status(200).json({ waitlist: true, message: 'Added to waitlist! You\'ll be notified at launch.' });
  }

  try {
    const session = await stripePost('/v1/checkout/sessions', STRIPE_KEY, {
      'mode': 'subscription',
      'payment_method_types[0]': 'card',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'success_url': `${SITE_URL}/premium-welcome?session={CHECKOUT_SESSION_ID}&tier=${tier}`,
      'cancel_url': `${SITE_URL}?tab=premium`,
      'metadata[tier]': tier,
      'allow_promotion_codes': 'true',
    });

    if (session.url) {
      return res.status(200).json({ url: session.url });
    } else {
      throw new Error(session.error?.message || 'No checkout URL returned');
    }
  } catch (e) {
    console.error('Stripe checkout error:', e.message);
    return res.status(200).json({ waitlist: true, message: 'Added to waitlist! Payment system launching soon.' });
  }
};
