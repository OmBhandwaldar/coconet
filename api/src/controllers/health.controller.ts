import { Request, Response } from 'express';

export function getHealth(req: Request, res: Response): void {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'coconet-api',
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId,
    },
  });
}
