const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./db/database'); // Initializes DB
const importWorker = require('./workers/importWorker');
const authRouter = require('./routes/auth');
const storesRouter = require('./routes/stores');
const importsRouter = require('./routes/imports');
const shopifyRouter = require('./routes/shopify');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api/auth', authRouter);
app.use('/api/stores', storesRouter);
app.use('/api/imports', importsRouter);
app.use('/api/shopify', shopifyRouter);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' })
});

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    // Start background worker
    importWorker.start();
    console.log('Background worker started.');
});
