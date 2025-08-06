const express = require('express');
const router = express.Router();

// Dashboard home route
router.get('/', (req, res) => {
    res.redirect('/dashboard.html');
});

router.get('/dashboard', (req, res) => {
    res.redirect('/dashboard.html');
});

module.exports = router;