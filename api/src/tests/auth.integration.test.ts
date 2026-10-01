import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import app from '../app.js';

const request = supertest(app);

// ─── Block 3: authentication and access control ──────────────────────────────
// Before this, the API had no authentication of any kind: anything that could
// reach the port could issue a PO or release an escrow, and every resulting
// ledger entry was attributed to a single hardcoded Platform Admin.

async function login(username: string, secret: string) {
  return request.post('/api/auth/login').send({ username, secret });
}

describe('POST /api/auth/login', () => {
  it('issues a token for valid credentials', async () => {
    const res = await login('rajesh', 'rajesh-dev-secret');
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.org_id).toBe('tata-001');
    expect(res.body.data.user.msp_id).toBe('BuyerMSP');
  });

  it('rejects a wrong secret with 401', async () => {
    const res = await login('rajesh', 'not-the-secret');
    expect(res.status).toBe(401);
    expect(res.body.data?.token).toBeUndefined();
  });

  it('rejects an unknown user with 401', async () => {
    const res = await login('mallory', 'anything');
    expect(res.status).toBe(401);
  });

  // Enumeration: an unknown user and a wrong secret must be indistinguishable.
  it('does not reveal whether the username exists', async () => {
    const unknown = await login('mallory', 'anything');
    const wrongPass = await login('rajesh', 'not-the-secret');
    expect(unknown.body.error.message).toBe(wrongPass.body.error.message);
  });
});

describe('authentication on protected routes', () => {
  it('rejects a request with no token', async () => {
    const res = await request.post('/api/trade-docs/purchase-orders').send({});
    expect(res.status).toBe(401);
  });

  it('rejects a malformed bearer token', async () => {
    const res = await request
      .post('/api/trade-docs/purchase-orders')
      .set('Authorization', 'Bearer not-a-jwt')
      .send({});
    expect(res.status).toBe(401);
  });

  it('accepts a valid token and reaches validation', async () => {
    const { body } = await login('rajesh', 'rajesh-dev-secret');
    const res = await request
      .post('/api/trade-docs/purchase-orders')
      .set('Authorization', `Bearer ${body.data.token}`)
      .send({});
    // Past auth, so the request is now rejected on its merits, not its identity.
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(400);
  });

  it('leaves health open', async () => {
    expect((await request.get('/api/health')).status).toBe(200);
  });
});

describe('RBAC', () => {
  it('lets a buyer create a purchase order', async () => {
    const { body } = await login('rajesh', 'rajesh-dev-secret');
    const res = await request
      .post('/api/trade-docs/purchase-orders')
      .set('Authorization', `Bearer ${body.data.token}`)
      .send({});
    expect(res.status).not.toBe(403);
  });

  // The control that matters: a supplier identity must not be able to raise a
  // purchase order against itself.
  it('forbids a supplier from creating a purchase order', async () => {
    const { body } = await login('kavitha', 'kavitha-dev-secret');
    const res = await request
      .post('/api/trade-docs/purchase-orders')
      .set('Authorization', `Bearer ${body.data.token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('forbids a buyer from raising an invoice', async () => {
    const { body } = await login('rajesh', 'rajesh-dev-secret');
    const res = await request
      .post('/api/trade-docs/invoices')
      .set('Authorization', `Bearer ${body.data.token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('forbids the auditor from writing anything', async () => {
    const { body } = await login('auditor', 'auditor-dev-secret');
    const res = await request
      .post('/api/trade-docs/purchase-orders')
      .set('Authorization', `Bearer ${body.data.token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('lets the auditor read', async () => {
    const { body } = await login('auditor', 'auditor-dev-secret');
    const res = await request
      .get('/api/activity')
      .set('Authorization', `Bearer ${body.data.token}`);
    expect(res.status).toBe(200);
  });
});

describe('identity is carried to the chain layer', () => {
  it('reports the caller identity on /api/auth/me', async () => {
    const { body } = await login('priya', 'priya-dev-secret');
    const res = await request
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.data.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('priya');
    expect(res.body.data.msp_id).toBe('BuyerMSP');
    expect(res.body.data.wallet_label).toBe('User2@buyer');
  });
});

// ─── security-review follow-ups ───────────────────────────────────────────────
describe('sensitive organisation fields', () => {
  async function tokenFor(username: string) {
    const res = await request.post('/api/auth/login').send({ username, secret: `${username}-dev-secret` });
    return res.body.data.token as string;
  }

  // Block 1 stripped risk_tier and the maker-checker threshold from chaincode
  // events because publishing them tells a member's competitors how the platform
  // rates it and how large a transaction it waves through on one signature. The
  // read API must not hand back what the event scrub removed.
  it('hides risk tier and thresholds from another member', async () => {
    const token = await tokenFor('kavitha'); // supplier reading the buyer's org
    const res = await request
      .get('/api/onboarding/organizations/tata-001')
      .set('Authorization', `Bearer ${token}`);
    if (res.status === 200) {
      expect(res.body.data).not.toHaveProperty('risk_tier');
      expect(res.body.data).not.toHaveProperty('maker_checker_thresholds');
    }
  });

  it('forbids a member from reading another org maker-checker threshold', async () => {
    const token = await tokenFor('kavitha');
    const res = await request
      .get('/api/onboarding/organizations/tata-001/maker-checker-thresholds/PurchaseOrder')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('activity feed scoping', () => {
  async function tokenFor(username: string) {
    const res = await request.post('/api/auth/login').send({ username, secret: `${username}-dev-secret` });
    return res.body.data.token as string;
  }

  // Event payloads no longer carry figures, but a global feed would still tell
  // every member who is trading with whom and how often — commercial
  // intelligence in its own right (PRIVACY-DESIGN.md §3.2).
  it('serves the feed to a member scoped to their own deals', async () => {
    const token = await tokenFor('kavitha');
    const res = await request.get('/api/activity').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const entry of res.body.data.entries) {
      if (entry.parties?.length) {
        expect(entry.parties).toContain('bharat-001');
      }
    }
  });

  it('gives the auditor the unscoped feed — observer access by charter', async () => {
    const token = await tokenFor('auditor');
    const res = await request.get('/api/activity').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
