const express = require('express');
const router = express.Router();

// Dashboard home route
router.get('/', (req, res) => {
    res.redirect('/dashboard.html');
});

router.get('/dashboard', (req, res) => {
    res.redirect('/dashboard.html');
});

// Database view route
router.get('/db', (req, res) => {
    res.redirect('/db.html');
});

// Queue view route
router.get('/queue', (req, res) => {
    res.redirect('/queue.html');
});

module.exports = router;