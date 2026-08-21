import { NextFunction, Request, Response } from 'express';
import * as service from '../services/trade-doc.service.js';
import * as documents from '../services/document.service.js';
import { ValidationError } from '../errors/AppError.js';

// ─── Purchase Orders ──────────────────────────────────────────────────────────
export async function createPO(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const po = await service.createPO(req.body);
    res.status(201).json({ success: true, data: po, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function getPO(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const po = await service.getPurchaseOrder(req.params.id);
    res.json({ success: true, data: po, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function acknowledgePO(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const po = await service.acknowledgePO(req.params.id, req.body.supplier_id);
    res.json({ success: true, data: po, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function amendPO(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const po = await service.amendPO(req.params.id, req.body.changes, req.body.justification);
    res.json({ success: true, data: po, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function lockPO(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const po = await service.lockPO(req.params.id);
    res.json({ success: true, data: po, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function fulfillPO(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const po = await service.fulfillPO(req.params.id);
    res.json({ success: true, data: po, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

// ─── Goods Receipt ──────────────────────────────────────────────────────────
export async function createGRN(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const grn = await service.createGRN(req.body.grn_id, req.body.po_id, req.body.received_qty, req.body.doc_hash);
    res.status(201).json({ success: true, data: grn, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function getGRN(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const grn = await service.getGRN(req.params.id);
    res.json({ success: true, data: grn, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function acceptGRN(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const grn = await service.acceptGRN(req.params.id);
    res.json({ success: true, data: grn, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

// ─── Invoices ─────────────────────────────────────────────────────────────────
export async function submitInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await service.submitInvoice(req.body);
    res.status(201).json({ success: true, data: invoice, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function getInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await service.getInvoice(req.params.id);
    res.json({ success: true, data: invoice, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function matchInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await service.runThreeWayMatch(req.params.id);
    res.json({ success: true, data: invoice, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function getMatchResult(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await service.getInvoice(req.params.id);
    res.json({ success: true, data: invoice.match_result ?? null, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function approveInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await service.approveInvoice(req.params.id);
    res.json({ success: true, data: invoice, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function rejectInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await service.rejectInvoice(req.params.id, req.body.reason ?? '');
    res.json({ success: true, data: invoice, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function disputeInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await service.disputeInvoice(req.params.id, req.body.reason ?? '');
    res.json({ success: true, data: invoice, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

// ─── Documents ────────────────────────────────────────────────────────────────
export async function uploadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new ValidationError('No file uploaded (expected multipart field "file")');
    const result = await documents.uploadDocument(req.file.buffer, req.file.mimetype);
    res.status(201).json({ success: true, data: result, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function verifyDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await documents.verifyDocument(req.params.hash);
    res.json({ success: true, data: result, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function parseDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new ValidationError('No file uploaded (expected multipart field "file")');
    const result = await documents.parseDocument(req.file.buffer, req.file.mimetype);
    res.json({ success: true, data: result, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function getDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const doc = await documents.getDocument(req.params.hash);
    if (!doc) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } }); return; }
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${req.params.hash}"`);
    doc.stream.pipe(res);
  } catch (err) { next(err); }
}
