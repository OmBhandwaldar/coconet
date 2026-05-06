import express from 'express';
import cors from 'cors';
import { correlationId } from './middleware/correlation-id.middleware.js';
import { requestLogger } from './middleware/logger.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';
import apiRouter from './routes/index.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(correlationId);
app.use(requestLogger);

app.use('/api', apiRouter);

// Root health alias
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

export default app;
