const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db/database');
const { encrypt } = require('../services/crypto');
const authMiddleware = require('../middleware/auth');

// POST /api/shopify/install (Protected)
router.post('/install', authMiddleware, async (req, res) => {
    const { store_name, shop_domain } = req.body;
    
    if (!shop_domain) {
        return res.status(400).json({ error: 'Shopify domain is required' });
    }

    const cleanDomain = shop_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    
    // Generate secure state
    const state = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins expiry

    try {
        await db.query(
            `INSERT INTO oauth_states (user_id, store_name, shop_domain, state, expires_at) VALUES ($1, $2, $3, $4, $5)`,
            [req.user.id, store_name || cleanDomain, cleanDomain, state, expiresAt]
        );

        const clientId = process.env.SHOPIFY_CLIENT_ID;
        const scopes = process.env.SHOPIFY_SCOPES;
        const redirectUri = process.env.SHOPIFY_REDIRECT_URI;

        const authUrl = `https://${cleanDomain}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;
        
        res.json({ authUrl });
    } catch (e) {
        console.error('Install route error:', e);
        res.status(500).json({ error: 'Failed to initiate install flow' });
    }
});

// GET /api/shopify/callback (Public, verifiable via HMAC)
router.get('/callback', async (req, res) => {
    const { code, shop, hmac, state } = req.query;

    if (!code || !shop || !hmac || !state) {
        return res.status(400).send('Missing required parameters');
    }

    // 1. Verify HMAC
    const map = Object.assign({}, req.query);
    delete map['hmac'];
    const message = Object.keys(map).sort().map(key => `${key}=${map[key]}`).join('&');
    const generatedHash = crypto.createHmac('sha256', process.env.SHOPIFY_CLIENT_SECRET).update(message).digest('hex');
    
    if (generatedHash !== hmac) {
        return res.status(400).send('HMAC validation failed');
    }

    // 2. Verify State and Expiry
    try {
        const { rows } = await db.query('SELECT * FROM oauth_states WHERE state = $1 AND shop_domain = $2', [state, shop]);
        const stateRecord = rows[0];

        if (!stateRecord) {
            return res.status(400).send('Invalid state or shop domain mismatch');
        }

        if (new Date() > new Date(stateRecord.expires_at)) {
            return res.status(400).send('OAuth session expired');
        }

        // Clean up the used state
        await db.query('DELETE FROM oauth_states WHERE state = $1', [state]);

        // 3. Exchange Code for Access Token
        const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: process.env.SHOPIFY_CLIENT_ID,
                client_secret: process.env.SHOPIFY_CLIENT_SECRET,
                code: code
            })
        });

        const tokenData = await tokenResponse.json();
        
        if (!tokenResponse.ok || !tokenData.access_token) {
            return res.status(400).send('Failed to retrieve access token from Shopify');
        }

        const accessToken = tokenData.access_token;
        const grantedScopes = tokenData.scope || process.env.SHOPIFY_SCOPES;

        // 4. Encrypt and Save
        const { iv, encryptedData, authTag } = encrypt(accessToken);

        // Check if store exists for user
        const { rows: storeRows } = await db.query('SELECT id FROM stores WHERE user_id = $1 AND store_domain = $2', [stateRecord.user_id, shop]);
        
        if (storeRows.length > 0) {
            await db.query(
                `UPDATE stores SET store_name = $1, encrypted_access_token = $2, iv = $3, auth_tag = $4, scopes = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6`,
                [stateRecord.store_name, encryptedData, iv, authTag, grantedScopes, storeRows[0].id]
            );
        } else {
            await db.query(
                `INSERT INTO stores (user_id, store_name, store_domain, encrypted_access_token, iv, auth_tag, scopes) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [stateRecord.user_id, stateRecord.store_name, shop, encryptedData, iv, authTag, grantedScopes]
            );
        }

        // 5. Redirect back to frontend dashboard
        // Hardcoding the typical Vite frontend URL since this is a backend redirect
        res.redirect('http://localhost:5173/dashboard');

    } catch (e) {
        console.error('Callback error:', e);
        res.status(500).send('Internal server error during callback processing');
    }
});

module.exports = router;
