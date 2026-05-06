import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { ValidationError } from '../errors/AppError.js';

// Validates req.body, req.params, req.query against a Zod schema shaped:
//   z.object({ body?: ..., params?: ..., query?: ... })
export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse({ body: req.body, params: req.params, query: req.query }) as {
        body?: unknown;
        params?: unknown;
        query?: unknown;
      };
      if (parsed.body) req.body = parsed.body;
      if (parsed.params) req.params = parsed.params as Request['params'];
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        next(new ValidationError(message));
        return;
      }
      next(err);
    }
  };
}
