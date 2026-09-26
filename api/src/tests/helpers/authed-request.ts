import supertest from 'supertest';
import app from '../../app.js';
import { findUser } from '../../auth/users.js';
import { issueToken } from '../../auth/jwt.js';

/**
 * A supertest agent that attaches a bearer token to every request.
 *
 * Defaults to 'platform', which satisfies every requireOrgType guard — these
 * suites exercise routing, validation and service wiring, not authorisation.
 * RBAC has its own suite (auth.integration.test.ts) where the identity IS the
 * thing under test.
 */
export function authedRequest(username = 'platform') {
  const user = findUser(username);
  if (!user) throw new Error(`No directory user '${username}'`);
  const { token } = issueToken(user);
  const agent = supertest(app);
  const verbs = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);

  return new Proxy(agent, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original === 'function' && verbs.has(String(prop))) {
        return (...args: unknown[]) =>
          (original as (...a: unknown[]) => supertest.Test)
            .apply(target, args)
            .set('Authorization', `Bearer ${token}`);
      }
      return original;
    },
  }) as ReturnType<typeof supertest>;
}
