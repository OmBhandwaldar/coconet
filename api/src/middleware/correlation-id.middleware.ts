import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-correlation-id'] as string) ?? uuidv4();
  req.correlationId = id;
  res.setHeader('x-correlation-id', id);
  next();
}

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}
