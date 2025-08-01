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
        fs.writeFileSync(DB_FILE, JSON.stringify({ stocks: {}, orders: [] }, null, 2));
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
    // Optionally update stocks here if order contains cart
    if (req.body.cart) {
        req.body.cart.forEach(item => {
            if (item.type === 'tshirt') {
                const { style, size } = item;
                if (db.stocks.tshirt?.[style]?.[size] > 0) {
                    db.stocks.tshirt[style][size]--;
                }
            }
            if (item.type === 'jort') {
                const { size } = item;
                if (db.stocks.jort?.[size] > 0) {
                    db.stocks.jort[size]--;
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
    
    if (!product.id) {
        // Create new ID
        product.id = crypto.randomBytes(4).toString('hex');
        db.products = db.products || [];
        db.products.push(product);
    } else {
        // Update existing
        const index = db.products.findIndex(p => p.id === product.id);
        if (index !== -1) {
            db.products[index] = product;
        } else {
            db.products.push(product);
        }
    }
    
    writeDB(db);
    res.json({ success: true, id: product.id });
});

// Delete product
app.delete('/api/products/:id', (req, res) => {
    const db = readDB();
    db.products = (db.products || []).filter(p => p.id !== req.params.id);
    writeDB(db);
    res.json({ success: true });
});

// Update readDB to initialize products
function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ 
            orders: [], 
            products: [],
            stocks: {
                tshirt: {
                    "grey-black": { S: 0, M: 0, L: 0, XL: 0 },
                    "white-black": { S: 0, M: 0, L: 0, XL: 0 },
                    "white-red": { S: 0, M: 0, L: 0, XL: 0 }
                },
                jort: { S: 0, M: 0, L: 0, XL: 0 }
            }
        }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}