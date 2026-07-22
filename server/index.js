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

const app = express();
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
  origin: process.env.CLIENT_URL || "http://localhost:5173"
}));

// Rate limiting - strict for auth, lenient for gameplay
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute for gameplay APIs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

app.use('/api/auth', authLimiter);
app.use('/api/queue', apiLimiter);
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Routes (rate limiting applied above)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/queue', require('./routes/buildingQueue'));
app.use('/api/game', require('./routes/game'));

// Make io accessible in routes
app.set('io', io);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Socket.io handlers
const SocketHandlers = require('./socket/handlers');
const socketHandlers = new SocketHandlers(io);

io.on('connection', (socket) => {
  socketHandlers.handleConnection(socket);
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

async function startServer() {
  try {
    getJwtSecret();
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cosmic_empire');
    console.log('✅ MongoDB connected');
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
