const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { parseFile } = require('../services/fileParser');
const authMiddleware = require('../middleware/auth');

const uploadDir = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir)
}

const upload = multer({ dest: uploadDir });

router.use(authMiddleware);

// Middleware to verify store ownership
const verifyStore = async (req, res, next) => {
    const storeId = req.body.store_id || req.query.store_id;
    if (!storeId) return res.status(400).json({ error: 'store_id is required' });

    try {
        const { rows } = await db.query('SELECT id FROM stores WHERE id = $1 AND user_id = $2', [storeId, req.user.id]);
        if (rows.length === 0) return res.status(403).json({ error: 'Unauthorized access to store' });
        next();
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
};

router.post('/upload', upload.single('file'), verifyStore, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        const parsedOrders = parseFile(req.file.path);
        res.json({
            filename: req.file.originalname,
            tmpPath: req.file.filename,
            parsedOrders: parsedOrders
        });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.post('/start', verifyStore, async (req, res) => {
    const { store_id, filename, orders } = req.body;
    
    if (!orders || !orders.length) {
        return res.status(400).json({ error: 'Invalid payload' });
    }

    // GROUP BY old_order_id
    const groupedOrdersMap = {};
    orders.forEach(order => {
        if (!groupedOrdersMap[order.old_order_id]) {
            groupedOrdersMap[order.old_order_id] = [];
        }
        groupedOrdersMap[order.old_order_id].push(order);
    });

    const groupedOrders = Object.values(groupedOrdersMap);

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        
        const insertJobRes = await client.query(
            `INSERT INTO imports (user_id, store_id, filename, status, total_orders) VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
            [req.user.id, store_id, filename, groupedOrders.length]
        );
        const importId = insertJobRes.rows[0].id;
        
        for (const orderGroup of groupedOrders) {
            const primaryEmail = orderGroup[0].email || '';
            const oldOrderId = orderGroup[0].old_order_id;
            await client.query(
                `INSERT INTO import_orders (import_id, old_order_id, customer_email, raw_payload_json) VALUES ($1, $2, $3, $4)`,
                [importId, oldOrderId, primaryEmail, JSON.stringify(orderGroup)]
            );
        }
        
        await client.query('COMMIT');
        res.json({ success: true, import_id: importId });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ error: 'Failed to create import job' });
    } finally {
        client.release();
    }
});

// Middleware to verify import job ownership
const verifyImportJob = async (req, res, next) => {
    const importId = req.params.id;
    try {
        const { rows } = await db.query('SELECT id FROM imports WHERE id = $1 AND user_id = $2', [importId, req.user.id]);
        if (rows.length === 0) return res.status(403).json({ error: 'Unauthorized access to import job' });
        next();
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
};

router.get('/:id/progress', verifyImportJob, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM imports WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Import not found' });
        res.json(rows[0]);
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
});

router.get('/:id/results', verifyImportJob, async (req, res) => {
    const importId = req.params.id;
    try {
        const { rows: orders } = await db.query(
            'SELECT * FROM import_orders WHERE import_id = $1 AND status IN ($2, $3, $4)', 
            [importId, 'failed', 'skipped_duplicate', 'created_with_custom_items']
        );
        const { rows: jobRows } = await db.query('SELECT * FROM imports WHERE id = $1', [importId]);
        
        res.json({
            job: jobRows[0],
            orders: orders.map(r => ({
                ...r,
                raw: JSON.parse(r.raw_payload_json)
            }))
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Database error' });
    }
});

router.get('/history', async (req, res) => {
    const storeId = req.query.store_id;
    try {
        let result;
        if (storeId) {
            result = await db.query('SELECT * FROM imports WHERE user_id = $1 AND store_id = $2 ORDER BY created_at DESC LIMIT 50', [req.user.id, storeId]);
        } else {
            result = await db.query('SELECT * FROM imports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
        }
        res.json(result.rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
