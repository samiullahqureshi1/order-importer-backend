const express = require('express');
const router = express.Router();
const db = require('../db/database');
const ShopifyClient = require('../services/shopifyClient');
const { encrypt } = require('../services/crypto');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/stores
router.get('/', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT id, store_name, store_domain, created_at FROM stores WHERE user_id = $1', [req.user.id]);
        res.json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Database error' });
    }
});



// DELETE /api/stores/:id
router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM stores WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to delete store' });
    }
});

module.exports = router;
