const xlsx = require('xlsx');

function parseFile(filePath) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Read as array of arrays to check headers
    const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    
    if (rawData.length === 0) {
        throw new Error('File is empty');
    }

    const firstRow = rawData[0].map(c => String(c).toLowerCase().trim());
    
    // Detect format
    const hasHeaders = firstRow.includes('sku') || firstRow.includes('handle') || firstRow.includes('customer name');

    let parsedOrders = [];

    if (hasHeaders) {
        // Format A
        // Read as objects based on headers
        const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });
        
        parsedOrders = data.map((row, index) => {
            return {
                row_index: index + 2, // 1-based + header
                old_order_id: String(row['ID'] || ''),
                sku: String(row['SKU'] || ''),
                handle: String(row['handle'] || ''),
                product_name: String(row['Product Name'] || row['product name'] || row['Product name'] || ''),
                customer_name: String(row['customer name'] || ''),
                email: String(row['email'] || ''),
                quantity: parseFloat(row['quantity']) || 1,
                price: parseFloat(row['price']) || 0,
                product_tax: parseFloat(row['product tax']) || 0,
                shipping_price: parseFloat(row['shipping price']) || 0,
                shipping_tax: parseFloat(row['shipping tax']) || 0,
                shipping_method: String(row['shipping method'] || ''),
                phone_number: String(row['phone number'] || ''),
                shipping_address: String(row['shipping address'] || ''),
                city: String(row['city'] || ''),
                state: String(row['state'] || ''),
                zip: String(row['zip'] || ''),
                country: String(row['country'] || ''),
                notes: String(row['notes'] || ''),
                status: String(row['status'] || '')
            };
        });
    } else {
        // Format B (headerless)
        parsedOrders = rawData.map((row, index) => {
            return {
                row_index: index + 1,
                old_order_id: String(row[1] || ''),
                sku: String(row[2] || ''),
                handle: String(row[3] || ''),
                product_name: String(row[0] || ''), // Assumed empty or fallback, usually format B relies on handles/skus. Will default to SKU/Handle fallback if empty later.
                customer_name: String(row[4] || ''),
                email: String(row[5] || ''),
                quantity: parseFloat(row[6]) || 1,
                price: parseFloat(row[7]) || 0,
                product_tax: parseFloat(row[8]) || 0,
                shipping_price: 0, // Not explicitly in Format B? We'll leave as 0
                shipping_tax: 0,
                shipping_method: '',
                phone_number: '',
                shipping_address: String(row[10] || ''),
                city: String(row[11] || ''),
                state: String(row[12] || ''),
                zip: String(row[13] || ''),
                country: String(row[14] || ''),
                notes: String(row[15] || ''),
                status: String(row[16] || '')
            };
        });
    }

    // Filter out rows that are completely empty or missing ID
    return parsedOrders.filter(o => o.old_order_id);
}

module.exports = {
    parseFile
};
