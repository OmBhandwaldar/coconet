import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import app from '../app.js';

const request = supertest(app);

// ─── Block 2: baseline HTTP hardening ────────────────────────────────────────
// The API had no security headers, no origin restriction, no rate limit and no
// body-size cap. Anything that can reach the port could call it, from anywhere,
// as often as it liked, with a payload of any size.

describe('security headers', () => {
  it('sets helmet headers on responses', async () => {
    const res = await request.get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeTruthy();
  });

  it('does not advertise the framework', async () => {
    const res = await request.get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows a configured origin', async () => {
    const res = await request.get('/health').set('Origin', 'http://localhost:3001');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
  });

  // The failure mode this closes: with an unrestricted cors(), any website open
  // in a user's browser could call the API with their credentials.
  it('does not echo an unknown origin back', async () => {
    const res = await request.get('/health').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('still serves same-origin requests that send no Origin header', async () => {
    const res = await request.get('/health');
    expect(res.status).toBe(200);
  });
});

describe('request body limits', () => {
  it('rejects a JSON body over the configured limit with 413', async () => {
    const huge = { blob: 'x'.repeat(2 * 1024 * 1024) }; // 2 MB
    const res = await request
      .post('/api/trade-docs/purchase-orders')
      .set('Content-Type', 'application/json')
      .send(huge);
    expect(res.status).toBe(413);
  });
});

describe('rate limiting', () => {
  it('returns 429 once the window limit is exceeded', async () => {
    // The limiter is keyed per IP; supertest reuses one, so the burst lands
    // on a single bucket.
    let sawTooMany = false;
    for (let i = 0; i < 260; i++) {
      const res = await request.get('/health');
      if (res.status === 429) { sawTooMany = true; break; }
    }
    expect(sawTooMany).toBe(true);
  });

  it('advertises the limit via standard RateLimit headers', async () => {
    const res = await request.get('/api/health');
    expect(res.headers['ratelimit-policy'] ?? res.headers['ratelimit']).toBeTruthy();
  });
});
