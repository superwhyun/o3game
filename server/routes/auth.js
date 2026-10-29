const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { settleUserState } = require('../services/GameStateService');
const { authMiddleware } = require('../middleware/admin');
const { apiError } = require('../utils/apiErrors');
const { getJwtSecret, verifyUserToken } = require('../utils/authToken');
const router = express.Router();
const { apiContext, errorHandler } = require('../utils/apiErrors');
router.use(apiContext, require('../middleware/apiValidation').apiValidation('/api/auth'));

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email: rawEmail, password } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    
    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(409).json({ error: 'Username or email already exists', code: 'ACCOUNT_EXISTS' });
    }
    
    // Create user (home planet is allocated on a free coordinate)
    const user = await User.createWithHomePlanet({ username, email, password });
    
    // Generate token
    const token = jwt.sign(
      { userId: user._id, tokenVersion: user.tokenVersion || 0 },
      getJwtSecret(),
      { expiresIn: '7d' }
    );
    
    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Find user by username
    const user = await User.findOne({ username });
    if (!user || user.isPirate) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'AUTH_INVALID_CREDENTIALS' });
    }
    
    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials', code: 'AUTH_INVALID_CREDENTIALS' });
    }
    
    if (user.isBanned) throw apiError(403, 'ACCOUNT_BANNED', '정지된 계정입니다.');

    // Update last login
    await User.updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } });
    
    // Generate token
    const token = jwt.sign(
      { userId: user._id, tokenVersion: user.tokenVersion || 0 },
      getJwtSecret(),
      { expiresIn: '7d' }
    );
    
    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
});

// Get current user
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const settled = await settleUserState(req.user._id, new Date());

    if (!settled?.user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(settled.snapshot);
    
  } catch (error) {
    throw error;
  }
});

// Check if any admin exists
router.get('/check-admin', async (req, res) => {
  try {
    const adminCount = await User.countDocuments({ isAdmin: true });
    res.json({ hasAdmin: adminCount > 0 });
  } catch (error) {
    throw error;
  }
});

// Setup first admin (only works when no admin exists)
router.post('/setup-admin', async (req, res) => {
  try {
    const { username, email: rawEmail, password } = req.body;
    const email = rawEmail?.trim().toLowerCase();
    
    // Check if admin already exists
    const adminExists = await User.findOne({ isAdmin: true });
    if (adminExists) {
      return res.status(409).json({ error: 'Admin already exists', code: 'ADMIN_ALREADY_EXISTS' });
    }
    
    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Check if username/email exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(409).json({ error: 'Username or email already exists', code: 'ACCOUNT_EXISTS' });
    }
    
    // Create admin user (home planet is allocated on a free coordinate)
    await require('../services/transactions').requireTransactions();
    const user = await require('../services/transactions').atomic(async () => {
      await require('../models/SystemLock').create({ _id: 'first-admin' });
      if (await User.exists({ isAdmin: true })) throw apiError(409, 'ADMIN_ALREADY_EXISTS', '관리자가 이미 존재합니다.');
      return User.createWithHomePlanet({ username, email, password, isAdmin: true, adminRole: 'superadmin' });
    });
    
    // Generate token
    const token = jwt.sign(
      { userId: user._id, tokenVersion: user.tokenVersion || 0 },
      getJwtSecret(),
      { expiresIn: '7d' }
    );
    
    res.status(201).json({
      message: 'Admin created successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: true
      }
    });
    
  } catch (error) {
    console.error('Admin setup error:', error);
    throw error;
  }
});

router.use(errorHandler);
module.exports = router;
