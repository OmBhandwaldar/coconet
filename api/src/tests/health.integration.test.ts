import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import app from '../app.js';

const request = supertest(app);

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /api/health', () => {
  it('returns 200 with success true and correlationId', async () => {
    const res = await request.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.correlationId).toBeTruthy();
  });

  it('echoes a supplied x-correlation-id header', async () => {
    const id = 'test-correlation-123';
    const res = await request.get('/api/health').set('x-correlation-id', id);
    expect(res.headers['x-correlation-id']).toBe(id);
    expect(res.body.data.correlationId).toBe(id);
  });
});
