import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env, corsOrigins } from './config/env.js';
import { correlationId } from './middleware/correlation-id.middleware.js';
import { requestLogger } from './middleware/logger.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';
import apiRouter from './routes/index.js';

const app = express();

// Security headers, and stop advertising Express to anyone fingerprinting the host.
app.use(helmet());
app.disable('x-powered-by');

// Origin allowlist. An unrestricted cors() lets any website open in a user's
// browser call this API on their behalf; an unknown origin now simply gets no
// CORS headers back. Requests with no Origin (server-to-server, curl, the demo
// script) are unaffected.
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (corsOrigins.includes('*') || corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));

// Body caps. File uploads use multer, so this does not constrain documents.
app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: env.JSON_BODY_LIMIT }));

app.use(rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
}));

app.use(correlationId);
app.use(requestLogger);

app.use('/api', apiRouter);

// Root health alias
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

export default app;
