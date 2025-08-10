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
            stocks: { /* existing stock structure */ }
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
    res.json(db.stocks);
});

// Set stocks (admin)
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
    // --- Deduct each item bought from stocks ---
    if (req.body.cart) {
        req.body.cart.forEach(item => {
            if (item.type === 'tshirt') {
                const { style, size } = item;
                if (db.stocks.tshirt?.[style]?.[size] !== undefined && db.stocks.tshirt[style][size] > 0) {
                    db.stocks.tshirt[style][size]--;
                }
            } else if (item.type === 'jort') {
                const { size } = item;
                if (db.stocks.jort?.[size] !== undefined && db.stocks.jort[size] > 0) {
                    db.stocks.jort[size]--;
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
                // If still not found, try matching by name directly
                if (!prodId && db.products && Array.isArray(db.products)) {
                    const prod = db.products.find(p => p.name === item.name);
                    if (prod) prodId = prod.id;
                }
                // Deduct stock for this product id and size
                if (prodId && item.size) {
                    if (!db.stocks[prodId]) db.stocks[prodId] = {};
                    if (db.stocks[prodId][item.size] !== undefined && db.stocks[prodId][item.size] > 0) {
                        db.stocks[prodId][item.size]--;
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

// Get all products
app.get('/api/products', (req, res) => {
    const db = readDB();
    res.json(db.products || []);
});

// Create/update product
app.post('/api/products', (req, res) => {
    const db = readDB();
    const product = req.body;

    // Basic validation
    if (!product.name || typeof product.price !== 'number' || !product.type) {
        return res.status(400).json({ success: false, error: 'Invalid product data' });
    }

    db.products = db.products || [];
    db.stocks = db.stocks || {};

    // If id is missing or empty, create new product
    if (!product.id || product.id === '') {
        product.id = crypto.randomBytes(4).toString('hex');
        
        // Initialize stocks for new product
        if (product.type === 'tshirt') {
            db.stocks.tshirt = db.stocks.tshirt || {};
            if (product.stock) {
                for (const style in product.stock) {
                    db.stocks.tshirt[style] = { ...product.stock[style] };
                }
            }
        } else if (product.type === 'jort') {
            db.stocks.jort = db.stocks.jort || {};
            if (product.stock) {
                for (const size in product.stock) {
                    db.stocks.jort[size] = product.stock[size];
                }
            }
        } else {
            // For other products, store by product id
            db.stocks[product.id] = { ...product.stock };
        }
        
        db.products.push(product);
        writeDB(db);
        return res.json({ success: true, id: product.id });
    } else {
        // Update existing product
        const index = db.products.findIndex(p => p.id === product.id);
        if (index !== -1) {
            // Update stocks
            if (product.type === 'tshirt') {
                db.stocks.tshirt = db.stocks.tshirt || {};
                if (product.stock) {
                    for (const style in product.stock) {
                        db.stocks.tshirt[style] = { ...product.stock[style] };
                    }
                }
            } else if (product.type === 'jort') {
                db.stocks.jort = db.stocks.jort || {};
                if (product.stock) {
                    for (const size in product.stock) {
                        db.stocks.jort[size] = product.stock[size];
                    }
                }
            } else {
                // For other products, update stock by id
                db.stocks[product.id] = { ...product.stock };
            }
            
            db.products[index] = product;
            writeDB(db);
            return res.json({ success: true, id: product.id });
        } else {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
    }
});

// Delete product
app.delete('/api/products/:id', (req, res) => {
    const db = readDB();
    const initialLength = (db.products || []).length;
    db.products = (db.products || []).filter(p => p.id !== req.params.id);
    writeDB(db);
    if (db.products.length < initialLength) {
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, error: 'Product not found' });
    }
});