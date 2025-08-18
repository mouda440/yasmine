const express = require('express');
const fs = require('fs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3001;
const DB_FILE = __dirname + '/db.json';

// Initialize app middleware
app.use(cors());
app.use(express.json());

// Rate limiting for API endpoints
app.use('/api/', rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per window
}));

// Admin authentication middleware
app.use('/api/admin*', (req, res, next) => {
    const auth = { login: 'admin', password: 'securepassword' }; // CHANGE THESE CREDENTIALS
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    if (login === auth.login && password === auth.password) return next();
    res.set('WWW-Authenticate', 'Basic realm="401"').status(401).send('Unauthorized');
});

// Database helper functions
function validateProduct(product) {
    return product && 
           typeof product.name === 'string' && 
           typeof product.price === 'number' &&
           ['tshirt', 'jort'].includes(product.type);
}

function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify({ 
                orders: [], 
                products: [],
                inventory: { 
                    products: {}, 
                    categories: {
                        tshirt: { styles: {}, sizes: ["S", "M", "L", "XL"] },
                        jort: { sizes: ["S", "M", "L", "XL"] }
                    }
                },
                stocks: {
                    tshirt: {},
                    jort: {}
                }
            }, null, 2));
        }
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
        console.error("DB read error:", err);
        return { orders: [], products: [], inventory: {}, stocks: {} };
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("DB write error:", err);
        throw err;
    }
}

function backupDB() {
    const backupPath = `${DB_FILE}.bak`;
    try {
        fs.copyFileSync(DB_FILE, backupPath);
        console.log(`Backup created at ${backupPath}`);
    } catch (err) {
        console.error("Backup failed:", err);
    }
}

// API Endpoints

// Products
app.get('/api/products', (req, res) => {
    const db = readDB();
    res.json(db.products || []);
});

app.post('/api/products', (req, res) => {
    if (!validateProduct(req.body)) {
        return res.status(400).json({ error: 'Invalid product data' });
    }

    backupDB();
    const db = readDB();
    const product = req.body;
    
    db.products = db.products || [];
    db.inventory = db.inventory || { products: {}, categories: {} };

    if (!product.id) {
        product.id = Math.random().toString(36).slice(2, 10);
        db.products.push(product);

        if (product.type === 'tshirt') {
            if (!db.inventory.categories.tshirt) {
                db.inventory.categories.tshirt = { styles: {}, sizes: ["S", "M", "L", "XL"] };
            }
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
    } else {
        const index = db.products.findIndex(p => p.id === product.id);
        if (index === -1) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        if (product.type === 'tshirt' && product.styles) {
            if (!db.inventory.categories.tshirt) {
                db.inventory.categories.tshirt = { styles: {}, sizes: ["S", "M", "L", "XL"] };
            }
            
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

app.delete('/api/admin/products/:id', (req, res) => {
    backupDB();
    const db = readDB();
    const id = req.params.id;
    
    db.products = (db.products || []).filter(p => p.id !== id);
    
    if (db.stocks && db.stocks[id]) {
        delete db.stocks[id];
    }
    
    writeDB(db);
    res.json({ success: true });
});

// Orders
app.get('/api/orders', (req, res) => {
    const db = readDB();
    res.json(db.orders);
});

app.post('/api/orders', (req, res) => {
    backupDB();
    const db = readDB();
    db.orders.push(req.body);

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
                let prodId = item.id || item.productId;
                if (!prodId && db.products && Array.isArray(db.products)) {
                    const baseName = item.name.split(' (')[0];
                    const prod = db.products.find(p => p.name === baseName);
                    if (prod) prodId = prod.id;
                }
                if (!prodId && db.products && Array.isArray(db.products)) {
                    const prod = db.products.find(p => p.name === item.name);
                    if (prod) prodId = prod.id;
                }
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

app.delete('/api/admin/orders/:index', (req, res) => {
    backupDB();
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

// Inventory
app.get('/api/inventory', (req, res) => {
    const db = readDB();
    res.json(db.inventory || {});
});

app.post('/api/inventory/product/:id', (req, res) => {
    backupDB();
    const db = readDB();
    const { id } = req.params;
    const stock = req.body;
    
    if (!db.inventory) db.inventory = { products: {}, categories: {} };
    
    const product = db.products.find(p => p.id === id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    
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

// Stocks
app.get('/api/stocks', (req, res) => {
    const db = readDB();
    res.json(db.stocks || {});
});

app.post('/api/stocks', (req, res) => {
    backupDB();
    const db = readDB();
    db.stocks = req.body;
    writeDB(db);
    res.json({ success: true });
});

app.post('/api/stocks/:productId', (req, res) => {
    backupDB();
    const db = readDB();
    const { productId } = req.params;
    const stockUpdate = req.body;
    
    const product = db.products?.find(p => p.id === productId);
    if (!product) {
        return res.status(404).json({ error: 'Product not found' });
    }

    if (product.type === 'tshirt') {
        if (!db.stocks.tshirt) db.stocks.tshirt = {};
        Object.assign(db.stocks.tshirt, stockUpdate);
    }
    else if (product.type === 'jort') {
        if (!db.stocks.jort) db.stocks.jort = {};
        Object.assign(db.stocks.jort, stockUpdate);
    }
    else {
        db.stocks[productId] = stockUpdate;
    }

    writeDB(db);
    res.json({ success: true });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Database file: ${DB_FILE}`);
});