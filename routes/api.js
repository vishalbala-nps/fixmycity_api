const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.send('Hello World!');
});

// Add more API routes here as needed

module.exports = router;
