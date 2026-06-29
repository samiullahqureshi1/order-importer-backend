class ShopifyClient {
    constructor(domain, accessToken) {
        this.domain = domain;
        this.accessToken = accessToken;
        this.apiUrl = `https://${domain}/admin/api/2024-01/graphql.json`;
    }

    async graphql(query, variables = {}) {
        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': this.accessToken
            },
            body: JSON.stringify({ query, variables })
        });

        const json = await response.json();
        
        if (json.errors) {
            throw new Error(`Shopify GraphQL Error: ${JSON.stringify(json.errors)}`);
        }
        
        if (json.data?.userErrors?.length > 0) {
            throw new Error(`Shopify User Error: ${JSON.stringify(json.data.userErrors)}`);
        }

        return json.data;
    }

    async verifyConnection() {
        const query = `
            query {
                shop {
                    name
                    primaryDomain {
                        url
                    }
                }
            }
        `;
        return await this.graphql(query);
    }

    async findProductVariantBySku(sku) {
        if (!sku) return null;
        const query = `
            query findVariant($query: String!) {
                productVariants(first: 1, query: $query) {
                    edges {
                        node {
                            id
                            price
                            product {
                                title
                            }
                        }
                    }
                }
            }
        `;
        const data = await this.graphql(query, { query: `sku:${sku}` });
        return data.productVariants.edges[0]?.node || null;
    }

    async findProductByHandle(handle) {
        if (!handle) return null;
        const query = `
            query findProduct($handle: String!) {
                productByHandle(handle: $handle) {
                    id
                    title
                    variants(first: 1) {
                        edges {
                            node {
                                id
                                price
                            }
                        }
                    }
                }
            }
        `;
        const data = await this.graphql(query, { handle });
        if (data.productByHandle) {
            return data.productByHandle.variants.edges[0]?.node || null;
        }
        return null;
    }

    async createOrder(orderInput) {
        const query = `
            mutation orderCreate($order: OrderCreateOrderInput!) {
                orderCreate(order: $order) {
                    order {
                        id
                        name
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }
        `;
        const data = await this.graphql(query, { order: orderInput });
        if (data.orderCreate.userErrors.length > 0) {
            throw new Error(JSON.stringify(data.orderCreate.userErrors));
        }
        return data.orderCreate.order;
    }

    async markOrderAsPaid(orderId) {
        // Find order transactions or just create a new transaction
        // First, calculate outstanding amount
        const orderQuery = `
            query($id: ID!) {
                order(id: $id) {
                    currentTotalPriceSet {
                        shopMoney {
                            amount
                            currencyCode
                        }
                    }
                }
            }
        `;
        const orderData = await this.graphql(orderQuery, { id: orderId });
        const amount = orderData.order.currentTotalPriceSet.shopMoney.amount;
        const currency = orderData.order.currentTotalPriceSet.shopMoney.currencyCode;

        // Create transaction
        const mutation = `
            mutation orderCapture($input: OrderCaptureInput!) {
                orderCapture(input: $input) {
                    transaction {
                        id
                        status
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }
        `;
        // orderCapture requires authorization transaction usually, but for manual payment we might need a different approach
        // Another option: orderCreate mutation allows specifying `transactions` in REST or `transactions` in GraphQL.
        // Actually, orderCreate in GraphQL doesn't easily support transactions natively sometimes. Let's rely on REST for transactions if needed,
        // or just use OrderCreateInput `transactions: [{kind: SALE, amount: x, gateway: "manual"}]` when creating the order.
        return null;
    }
}

module.exports = ShopifyClient;
