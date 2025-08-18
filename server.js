const express = require('express');
const fs = require('fs');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3001;
const DB_FILE = __dirname + '/db.json';
const crypto = require('crypto');

app.use(cors());
app.use(express.json());

// Helper to read/write DB
function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        // Initialize with empty products array
        fs.writeFileSync(DB_FILE, JSON.stringify({ 
            orders: [], 
            products: [],
            stocks: { 
                tshirt: {
                    'grey-black': { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 },
                    'white-black': { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 },
                    'white-red': { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 }
                },
                jort: { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 }
            },
            inventory: {
                products: {},
                categories: {
                    tshirt: {
                        styles: {
                            'grey-black': { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 },
                            'white-black': { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 },
                            'white-red': { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 }
                        },
                        sizes: ["S", "M", "L", "XL"]
                    },
                    jort: { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 }
                }
            }
        }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Get stocks
app.get('/api/stocks', (req, res) => {
    const db = readDB();
    res.json(db.stocks || {});
});

// Update stocks
app.post('/api/stocks', (req, res) => {
    const db = readDB();
    db.stocks = req.body;
    writeDB(db);
    res.json({ success: true });
});

// Get orders
app.get('/api/orders', (req, res) => {
    const db = readDB();
    res.json(db.orders);
});

// Add order
app.post('/api/orders', (req, res) => {
    const db = readDB();
    db.orders.push(req.body);
    
    // Deduct stock from inventory when order is placed
    if (req.body.cart) {
        req.body.cart.forEach(item => {
            if (item.type === 'tshirt') {
                const { style, size } = item;
                if (db.inventory?.categories?.tshirt?.styles?.[style]?.[size] !== undefined && 
                    db.inventory.categories.tshirt.styles[style][size] > 0) {
                    db.inventory.categories.tshirt.styles[style][size]--;
                }
            } else if (item.type === 'jort') {
                const { size } = item;
                if (db.inventory?.categories?.jort?.[size] !== undefined && 
                    db.inventory.categories.jort[size] > 0) {
                    db.inventory.categories.jort[size]--;
                }
            } else {
                // For other products, use product id and size
                let prodId = item.id || item.productId;
                // Try to find product id from products array if not present
                if (!prodId && db.products && Array.isArray(db.products)) {
                    // Try to match by name (before any " (" for style/size)
                    const baseName = item.name.split(' (')[0];
                    const prod = db.products.find(p => p.name === baseName);
                    if (prod) prodId = prod.id;
                }
                // Deduct stock for this product id and size
                if (prodId && item.size) {
                    if (!db.inventory.products) db.inventory.products = {};
                    if (!db.inventory.products[prodId]) db.inventory.products[prodId] = {};
                    if (db.inventory.products[prodId][item.size] !== undefined && 
                        db.inventory.products[prodId][item.size] > 0) {
                        db.inventory.products[prodId][item.size]--;
                    }
                }
            }
        });
    }
    
    writeDB(db);
    res.json({ success: true });
});

// Delete order (admin)
app.delete('/api/orders/:index', (req, res) => {
    const db = readDB();
    const idx = parseInt(req.params.index, 10);
    if (idx >= 0 && idx < db.orders.length) {
        db.orders.splice(idx, 1);
        writeDB(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Order not found' });
    }
});

app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});

// Get products
app.get('/api/products', (req, res) => {
    const db = readDB();
    res.json(db.products || []);
});

// Create/update product
app.post('/api/products', (req, res) => {
    const db = readDB();
    const product = req.body;
    
    if (!product.name || typeof product.price !== 'number' || !product.type) {
        return res.status(400).json({ success: false, error: 'Invalid product data' });
    }

    db.products = db.products || [];
    db.inventory = db.inventory || { products: {}, categories: {} };

    // If no id, create new product
    if (!product.id) {
        product.id = Math.random().toString(36).slice(2, 10);
        db.products.push(product);

        // Initialize inventory structure based on product type
        if (product.type === 'tshirt') {
            if (!db.inventory.categories.tshirt) {
                db.inventory.categories.tshirt = { styles: {}, sizes: ["S", "M", "L", "XL"] };
            }
            // Initialize stock for each style
            const styles = (product.styles && Array.isArray(product.styles)) 
                ? product.styles 
                : [{ value: 'grey-black' }, { value: 'white-black' }, { value: 'white-red' }];

            styles.forEach(style => {
                if (!db.inventory.categories.tshirt.styles[style.value]) {
                    db.inventory.categories.tshirt.styles[style.value] = {
                        'S': 0, 'M': 0, 'L': 0, 'XL': 0
                    };
                }
            });
        }
        else if (product.type === 'jort') {
            if (!db.inventory.categories.jort) {
                db.inventory.categories.jort = { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 };
            }
        }
        else {
            db.inventory.products[product.id] = { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 };
        }
    } 
    // Update existing product
    else {
        const index = db.products.findIndex(p => p.id === product.id);
        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        
        // Update inventory structure if styles changed
        if (product.type === 'tshirt' && product.styles) {
            if (!db.inventory.categories.tshirt) {
                db.inventory.categories.tshirt = { styles: {}, sizes: ["S", "M", "L", "XL"] };
            }
            
            // Initialize new styles while preserving existing stock
            product.styles.forEach(style => {
                if (!db.inventory.categories.tshirt.styles[style.value]) {
                    db.inventory.categories.tshirt.styles[style.value] = {
                        'S': 0, 'M': 0, 'L': 0, 'XL': 0
                    };
                }
            });
        }
        
        db.products[index] = product;
    }

    writeDB(db);
    res.json({ success: true, id: product.id });
});

// Delete product
app.delete('/api/products/:id', (req, res) => {
    const db = readDB();
    const id = req.params.id;
    
    db.products = (db.products || []).filter(p => p.id !== id);
    
    // Clean up associated stocks
    if (db.inventory?.products && db.inventory.products[id]) {
        delete db.inventory.products[id];
    }
    
    writeDB(db);
    res.json({ success: true });
});

// Update stock for specific product
app.post('/api/stocks/:productId', (req, res) => {
    const db = readDB();
    const { productId } = req.params;
    const stockUpdate = req.body;
    
    const product = db.products?.find(p => p.id === productId);
    if (!product) {
        return res.status(404).json({ success: false, error: 'Product not found' });
    }

    // Ensure inventory structure exists
    if (!db.inventory) db.inventory = { products: {}, categories: {} };

    if (product.type === 'tshirt') {
        if (!db.inventory.categories.tshirt) {
            db.inventory.categories.tshirt = { styles: {}, sizes: ["S", "M", "L", "XL"] };
        }
        Object.assign(db.inventory.categories.tshirt.styles, stockUpdate);
    }
    else if (product.type === 'jort') {
        if (!db.inventory.categories.jort) {
            db.inventory.categories.jort = {};
        }
        Object.assign(db.inventory.categories.jort, stockUpdate);
    }
    else {
        db.inventory.products[productId] = stockUpdate;
    }

    writeDB(db);
    res.json({ success: true });
});

// Get inventory status
app.get('/api/inventory', (req, res) => {
    const db = readDB();
    // Ensure we have the proper structure
    if (!db.inventory) {
        db.inventory = {
            products: {},
            categories: {
                tshirt: {
                    styles: {},
                    sizes: ["S", "M", "L", "XL"]
                },
                jort: {}
            }
        };
    }
    res.json(db.inventory);
});

// Update product stock
app.post('/api/inventory/product/:id', (req, res) => {
    const db = readDB();
    const { id } = req.params;
    const stock = req.body;
    
    if (!db.inventory) db.inventory = { products: {}, categories: {} };
    
    // Validate product exists
    const product = db.products.find(p => p.id === id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    
    // Update stock based on product type
    if (product.type === 'tshirt') {
        if (!db.inventory.categories.tshirt) {
            db.inventory.categories.tshirt = { styles: {}, sizes: ["S", "M", "L", "XL"] };
        }
        db.inventory.categories.tshirt.styles = {
            ...db.inventory.categories.tshirt.styles,
            ...stock
        };
    }
    else if (product.type === 'jort') {
        if (!db.inventory.categories.jort) {
            db.inventory.categories.jort = { sizes: ["S", "M", "L", "XL"] };
        }
        db.inventory.categories.jort = {
            ...db.inventory.categories.jort,
            ...stock
        };
    }
    else {
        db.inventory.products[id] = stock;
    }
    
    writeDB(db);
    res.json({ success: true });
});

// Check stock availability
app.get('/api/inventory/check', (req, res) => {
    const db = readDB();
    const { productId, style, size } = req.query;
    
    const product = db.products.find(p => p.id === productId);
    if (!product) return res.json({ available: 0 });
    
    let stock = 0;
    
    if (product.type === 'tshirt') {
        stock = db.inventory?.categories?.tshirt?.styles?.[style]?.[size] || 0;
    }
    else if (product.type === 'jort') {
        stock = db.inventory?.categories?.jort?.[size] || 0;
    }
    else {
        stock = db.inventory?.products?.[productId]?.[size] || 0;
    }
    
    res.json({ available: stock });
});

// Bulk update inventory
app.post('/api/inventory/bulk', (req, res) => {
    const db = readDB();
    db.inventory = req.body;
    writeDB(db);
    res.json({ success: true });
});