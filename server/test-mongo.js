const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/cosmic_empire')
  .then(() => {
    console.log('✅ MongoDB connected!');
    process.exit(0);
  })
  .catch(err => {
    console.log('❌ MongoDB error:', err.message);
    process.exit(1);
  });
