const db = require('../db/database');
const { processOrder } = require('../services/orderImporter');

let isRunning = false;

async function runWorker() {
    if (isRunning) return;
    isRunning = true;

    try {
        // Find one pending order to process
        const { rows: pendingRows } = await db.query(`SELECT * FROM import_orders WHERE status = 'pending' LIMIT 1`);
        const order = pendingRows[0];
        
        if (!order) {
            isRunning = false;
            return; // Nothing to process
        }

        // Mark as processing
        await db.query(`UPDATE import_orders SET status = 'processing' WHERE id = $1`, [order.id]);

        // Parse the raw payload
        const orderRecord = JSON.parse(order.raw_payload_json);
        
        try {
            const result = await processOrder(order.import_id, orderRecord);
            
            // Update order status
            await db.query(
                `UPDATE import_orders SET status = $1, shopify_order_id = $2, used_custom_items = $3, error_message = $4 WHERE id = $5`,
                [result.status, result.shopify_order_id, result.used_custom_items ? true : false, result.error, order.id]
            );
            
            // Update import job stats
            let columnToUpdate = '';
            if (result.status === 'created') columnToUpdate = 'created_count = created_count + 1';
            else if (result.status === 'created_with_custom_items') columnToUpdate = 'created_count = created_count + 1, custom_item_count = custom_item_count + 1';
            else if (result.status === 'skipped_duplicate') columnToUpdate = 'duplicate_count = duplicate_count + 1';
            else if (result.status === 'failed') columnToUpdate = 'failed_count = failed_count + 1';

            if (columnToUpdate) {
                await db.query(`UPDATE imports SET ${columnToUpdate} WHERE id = $1`, [order.import_id]);
                
                // Check if all orders for this import are done
                const { rows: countRows } = await db.query(
                    `SELECT COUNT(*) as pendingCount FROM import_orders WHERE import_id = $1 AND status IN ('pending', 'processing')`, 
                    [order.import_id]
                );
                
                if (countRows.length > 0 && parseInt(countRows[0].pendingcount) === 0) {
                    await db.query(`UPDATE imports SET status = 'completed' WHERE id = $1`, [order.import_id]);
                }
            }
            
            isRunning = false;
            // Trigger next immediately
            setTimeout(runWorker, 100);
        } catch (e) {
            console.error('Critical worker error:', e);
            await db.query(`UPDATE import_orders SET status = 'failed', error_message = $1 WHERE id = $2`, [e.message, order.id]);
            await db.query(`UPDATE imports SET failed_count = failed_count + 1 WHERE id = $1`, [order.import_id]);
            isRunning = false;
            setTimeout(runWorker, 100);
        }
    } catch (e) {
        console.error('Worker loop error:', e);
        isRunning = false;
    }
}

function start() {
    setInterval(runWorker, 1000);
}

module.exports = {
    start
};
