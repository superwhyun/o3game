const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { settleUserState } = require('../services/GameStateService');
const { getJwtSecret, verifyUserToken } = require('../utils/authToken');
const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
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
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    
    // Create user (home planet is allocated on a free coordinate)
    const user = await User.createWithHomePlanet({ username, email, password });
    
    // Generate token
    const token = jwt.sign(
      { userId: user._id },
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
    res.status(500).json({ error: 'Server error' });
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
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    user.lastLogin = new Date();
    await user.save();
    
    // Generate token
    const token = jwt.sign(
      { userId: user._id },
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
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = verifyUserToken(token);
    const settled = await settleUserState(decoded.userId, new Date());

    if (!settled?.user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(settled.snapshot);
    
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Check if any admin exists
router.get('/check-admin', async (req, res) => {
  try {
    const adminCount = await User.countDocuments({ isAdmin: true });
    res.json({ hasAdmin: adminCount > 0 });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Setup first admin (only works when no admin exists)
router.post('/setup-admin', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Check if admin already exists
    const adminExists = await User.findOne({ isAdmin: true });
    if (adminExists) {
      return res.status(403).json({ error: 'Admin already exists' });
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
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    
    // Create admin user (home planet is allocated on a free coordinate)
    const user = await User.createWithHomePlanet({
      username,
      email,
      password,
      isAdmin: true,
      adminRole: 'superadmin'
    });
    
    // Generate token
    const token = jwt.sign(
      { userId: user._id },
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
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
