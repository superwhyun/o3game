require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const entityConfigService = require('./services/EntityConfigService');
const { getJwtSecret } = require('./utils/authToken');

const { apiContext, apiError, errorHandler } = require('./utils/apiErrors');
const app = express();
app.use(apiContext);
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Security middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'RateLimit-Policy', 'Allow'],
  origin: process.env.CLIENT_URL || "http://localhost:5173"
}));

// Rate limiting - strict for auth, lenient for gameplay
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 1000 : 100, // Repeated isolated UI regressions share one server.
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => require('./utils/apiErrors').sendError(req, res, apiError(429, 'RATE_LIMITED', '인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')),
});

const apiLimiter = require('./middleware/rateLimits').createApiLimiter();

for (const endpoint of ['login', 'register', 'setup-admin']) {
  app.use(`/api/auth/${endpoint}`, authLimiter);
}
app.use('/api/', (req, res, next) => req.path.startsWith('/ai-worker/') ? next() : apiLimiter(req, res, next));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && ['POST','PUT','PATCH','DELETE'].includes(req.method) && (Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding']) && !req.is('application/json')) return next(apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'application/json 본문을 보내 주세요.'));
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Routes (rate limiting applied above)
app.use('/api/ai-worker', require('./routes/aiWorker'));
app.use('/api/auth', require('./routes/auth'));
app.use(['/api/account/email', '/api/account/password'], authLimiter);
app.use('/api/account', require('./routes/account'));
app.use('/api/admin', require('./routes/admin'));
app.use(['/api/queue', '/api/game'], require('./middleware/maintenance'));
app.use('/api/queue', require('./routes/buildingQueue'));
app.use('/api/game', require('./routes/game'));

// Make io accessible in routes
app.set('io', io);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/ready', async (req, res, next) => {
  try { await mongoose.connection.db.command({ ping: 1 }); if (!(await require('./services/transactions').supportsTransactions())) throw apiError(503, 'TRANSACTIONS_REQUIRED', 'DB 설정을 확인해 주세요.'); res.json({ status: 'OK', timestamp: new Date().toISOString() }); } catch (error) { next(error.statusCode ? error : apiError(503, 'SERVICE_UNAVAILABLE', '서비스를 사용할 수 없습니다.')); }
});

// Socket.io handlers
const SocketHandlers = require('./socket/handlers');
const socketHandlers = new SocketHandlers(io);

io.on('connection', (socket) => {
  socketHandlers.handleConnection(socket);
});

// All unmatched paths and parser/async failures use the same JSON contract.
app.use((req, res, next) => {
  const route = require('./data/apiRoutes.json').find(row => new RegExp('^' + row.path.replace(/\{[^}]+\}/g, '[^/]+') + '/?$').test(req.path));
  if (route) { res.setHeader('Allow', route.methods.join(', ')); return next(apiError(405, 'METHOD_NOT_ALLOWED', '이 경로에서 지원하지 않는 HTTP 메서드입니다.')); }
  next(apiError(404, 'ROUTE_NOT_FOUND', '존재하지 않는 API 경로입니다.'));
});
app.use(errorHandler);

async function startServer() {
  try {
    getJwtSecret();
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cosmic_empire');
    const transactionsEnabled = await require('./services/transactions').supportsTransactions();
    console.log('✅ MongoDB connected');
    if (!transactionsEnabled) console.warn('Construction and fleet mutations need a replica set; login and state reads remain available.');
    await entityConfigService.initialize();
    console.log(`🧠 Entity catalog loaded (revision ${entityConfigService.getRevision()})`);

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Socket.io ready for connections`);
    });
  } catch (err) {
    console.error('❌ Server startup failed:', err);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server, io, startServer };
