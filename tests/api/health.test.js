import { describe, expect, it, vi } from 'vitest';
import handler from '../../api/health.js';

const response = () => ({
  statusCode: 200,
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  end: vi.fn(),
});

describe('/api/health', () => {
  it('returns an uncached JSON health response', () => {
    const res = response();
    handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toEqual({ status: 'alive' });
  });

  it('supports HEAD and rejects mutation methods', () => {
    const head = response();
    handler({ method: 'HEAD' }, head);
    expect(head.statusCode).toBe(200);
    expect(head.end).toHaveBeenCalledTimes(1);

    const post = response();
    handler({ method: 'POST' }, post);
    expect(post.statusCode).toBe(405);
    expect(post.headers.Allow).toBe('GET, HEAD');
  });
});
