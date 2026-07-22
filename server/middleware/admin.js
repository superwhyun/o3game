const User = require('../models/User');
const { verifyUserToken } = require('../utils/authToken');

// Regular auth middleware (no admin required)
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = verifyUserToken(token);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    req.user = user;
    next();
    
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const adminMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = verifyUserToken(token);
    const user = await User.findById(decoded.userId);
    
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    req.user = user;
    next();
    
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const superAdminMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = verifyUserToken(token);
    const user = await User.findById(decoded.userId);
    
    if (!user || !user.isAdmin || user.adminRole !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin access required' });
    }
    
    req.user = user;
    next();
    
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = { authMiddleware, adminMiddleware, superAdminMiddleware };
