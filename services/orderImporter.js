const db = require('../db/database');
const ShopifyClient = require('./shopifyClient');
const { decrypt } = require('./crypto');

async function processOrderGroup(importId, orderGroupArr) {
    return new Promise(async (resolve, reject) => {
        try {
            const { rows: importRows } = await db.query('SELECT * FROM imports WHERE id = $1', [importId]);
            const importJob = importRows[0];
            if (!importJob) return reject(new Error('Import not found'));

            const { rows: storeRows } = await db.query('SELECT * FROM stores WHERE id = $1', [importJob.store_id]);
            const store = storeRows[0];
            if (!store) return reject(new Error('Store not found'));

            const accessToken = decrypt(store.encrypted_access_token, store.iv, store.auth_tag);
            const client = new ShopifyClient(store.store_domain, accessToken);

            // orderGroupArr is an array of rows sharing the same old_order_id
            const primaryRecord = orderGroupArr[0];

            // 1. Duplicate check (local DB)
            const { rows: duplicateRows } = await db.query(
                `SELECT id FROM import_orders WHERE import_id = $1 AND old_order_id = $2 AND status IN ('created', 'created_with_custom_items')`, 
                [importId, primaryRecord.old_order_id]
            );

            if (duplicateRows.length > 0) {
                return resolve({ status: 'skipped_duplicate' });
            }

            // First, get store currency
            const shopQuery = `query { shop { currencyCode } }`;
            const shopData = await client.graphql(shopQuery);
            const currency = shopData.shop.currencyCode || 'USD';

            const getPriceSet = (val) => ({
                shopMoney: { amount: val.toString(), currencyCode: currency },
                presentmentMoney: { amount: val.toString(), currencyCode: currency }
            });

            // 2. Product Matching for ALL items
            const lineItems = [];
            let usedCustomItem = false;
            let totalAmount = 0;

            for (const itemRecord of orderGroupArr) {
                let variantId = null;
                let itemPrice = parseFloat(itemRecord.price) || 0;
                let itemQty = parseInt(itemRecord.quantity, 10) || 1;
                let itemProductTax = parseFloat(itemRecord.product_tax) || 0;
                let itemShippingPrice = parseFloat(itemRecord.shipping_price) || 0;
                let itemShippingTax = parseFloat(itemRecord.shipping_tax) || 0;

                if (itemRecord.sku) {
                    const variant = await client.findProductVariantBySku(itemRecord.sku);
                    if (variant) {
                        variantId = variant.id;
                    }
                }

                if (!variantId && itemRecord.handle) {
                    const variant = await client.findProductByHandle(itemRecord.handle);
                    if (variant) {
                        variantId = variant.id;
                    }
                }

                if (!variantId) {
                    usedCustomItem = true;
                }

                if (variantId) {
                    lineItems.push({
                        variantId: variantId,
                        quantity: itemQty,
                        priceSet: getPriceSet(itemPrice),
                        taxLines: itemProductTax > 0 ? [{ priceSet: getPriceSet(itemProductTax), title: "Product Tax", rate: 0 }] : []
                    });
                } else {
                    const customTitle = itemRecord.product_name || `Custom Item - SKU: ${itemRecord.sku || 'N/A'}, Handle: ${itemRecord.handle || 'N/A'}`;
                    lineItems.push({
                        title: customTitle,
                        quantity: itemQty,
                        priceSet: getPriceSet(itemPrice),
                        taxLines: itemProductTax > 0 ? [{ priceSet: getPriceSet(itemProductTax), title: "Product Tax", rate: 0 }] : []
                    });
                }

                totalAmount += (itemPrice * itemQty) + itemProductTax + itemShippingPrice + itemShippingTax;
            }

            // For shipping, we just take the primary record's shipping since usually shipping is per order
            const primaryShippingPrice = parseFloat(primaryRecord.shipping_price) || 0;
            const primaryShippingTax = parseFloat(primaryRecord.shipping_tax) || 0;
            
            const shippingLines = [];
            if (primaryShippingPrice > 0) {
                shippingLines.push({
                    title: primaryRecord.shipping_method || 'Standard Shipping',
                    priceSet: getPriceSet(primaryShippingPrice),
                    taxLines: primaryShippingTax > 0 ? [{ priceSet: getPriceSet(primaryShippingTax), title: "Shipping Tax", rate: 0 }] : []
                });
            }

            // 3. Construct Order Payload
            const orderInput = {
                email: primaryRecord.email || undefined,
                phone: primaryRecord.phone_number || undefined,
                tags: ['import through thefoldtech'],
                note: primaryRecord.notes || undefined,
                shippingAddress: {
                    address1: primaryRecord.shipping_address,
                    city: primaryRecord.city,
                    province: primaryRecord.state,
                    zip: primaryRecord.zip,
                    country: primaryRecord.country,
                    firstName: primaryRecord.customer_name ? primaryRecord.customer_name.split(' ')[0] : '',
                    lastName: primaryRecord.customer_name ? primaryRecord.customer_name.split(' ').slice(1).join(' ') : ''
                },
                lineItems: lineItems,
                shippingLines: shippingLines,
                transactions: [
                    {
                        kind: "SALE",
                        status: "SUCCESS",
                        amountSet: getPriceSet(totalAmount)
                    }
                ]
            };

            const createdOrder = await client.createOrder(orderInput);
            
            resolve({
                status: usedCustomItem ? 'created_with_custom_items' : 'created',
                shopify_order_id: createdOrder.id,
                used_custom_items: usedCustomItem,
                error: null
            });

        } catch (error) {
            resolve({
                status: 'failed',
                shopify_order_id: null,
                used_custom_items: false,
                error: error.message
            });
        }
    });
}

module.exports = {
    processOrder: processOrderGroup
};
