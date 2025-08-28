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

// Ensure CORS headers for all responses (for development)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // Allow all origins
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    next();
});

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
           typeof product.type === 'string'; // Allow any type
}

function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify({ 
                orders: [], 
                products: [],
                inventory: {
                    products: {}  // Simplified inventory structure
                }
            }, null, 2));
        }
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
        console.error("DB read error:", err);
        return { orders: [], products: [], inventory: { products: {} } };
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

        // --- Initialize inventory per style for t-shirts ---
        if (product.type === 'tshirt') {
            if (!db.inventory.products[product.id]) db.inventory.products[product.id] = {};
            const styles = (product.styles && Array.isArray(product.styles)) 
                ? product.styles 
                : [{ value: 'grey-black' }, { value: 'white-black' }, { value: 'white-red' }];
            styles.forEach(style => {
                if (!db.inventory.products[product.id][style.value]) {
                    db.inventory.products[product.id][style.value] = {
                        'S': 0, 'M': 0, 'L': 0, 'XL': 0
                    };
                }
            });
        }
        // --- Jort: flat sizes ---
        else if (product.type === 'jort') {
            db.inventory.products[product.id] = { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 };
        }
        // --- Other products: flat sizes ---
        else {
            db.inventory.products[product.id] = { 'S': 0, 'M': 0, 'L': 0, 'XL': 0 };
        }
    } else {
        const index = db.products.findIndex(p => p.id === product.id);
        if (index === -1) {
            return res.status(404).json({ error: 'Product not found' });
        }
        // --- Update inventory for t-shirts if styles changed ---
        if (product.type === 'tshirt' && product.styles) {
            if (!db.inventory.products[product.id]) db.inventory.products[product.id] = {};
            product.styles.forEach(style => {
                if (!db.inventory.products[product.id][style.value]) {
                    db.inventory.products[product.id][style.value] = {
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

    // Remove stock for this product
    if (db.stocks && db.stocks[id]) {
        delete db.stocks[id];
    }
    // Remove any stocks that are not 'tshirt' or 'jort'
    Object.keys(db.stocks).forEach(key => {
        if (key !== 'tshirt' && key !== 'jort') {
            delete db.stocks[key];
        }
    });
    // Remove any inventory.products entries for deleted/old products
    if (db.inventory && db.inventory.products) {
        Object.keys(db.inventory.products).forEach(key => {
            if (!db.products.find(p => p.id === key)) {
                delete db.inventory.products[key];
            }
        });
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
    try {
        backupDB();
        const db = readDB();
        const order = req.body;

        // Validate order has required fields
        if (!order.cart || !order.name || !order.number || !order.email || !order.address) {
            return res.status(400).json({ error: 'Invalid order data' });
        }

        // --- GROUP CART ITEMS BY PRODUCT/STYLE/SIZE ---
        const cartCount = {};
        for (const item of order.cart) {
            const productId = item.id;
            const style = item.style || null;
            const size = item.size;
            if (!cartCount[productId]) cartCount[productId] = {};
            // For t-shirts, group by style+size
            if (item.type === 'tshirt' && style) {
                if (!cartCount[productId][style]) cartCount[productId][style] = {};
                if (!cartCount[productId][style][size]) cartCount[productId][style][size] = 0;
                cartCount[productId][style][size]++;
            } else {
                // For other products, group by size
                if (!cartCount[productId][size]) cartCount[productId][size] = 0;
                cartCount[productId][size]++;
            }
        }

        // --- CHECK STOCK FOR ALL ITEMS ---
        let stockError = false;
        for (const productId in cartCount) {
            const product = db.products.find(p => p.id === productId);
            if (product && product.type === 'tshirt') {
                for (const style in cartCount[productId]) {
                    for (const size in cartCount[productId][style]) {
                        const inCart = cartCount[productId][style][size];
                        const inStock = db.inventory.products?.[productId]?.[style]?.[size] ?? 0;
                        if (inStock < inCart) {
                            stockError = true;
                        }
                    }
                }
            } else {
                for (const size in cartCount[productId]) {
                    const inCart = cartCount[productId][size];
                    const inStock = db.inventory.products?.[productId]?.[size] ?? 0;
                    if (inStock < inCart) {
                        stockError = true;
                    }
                }
            }
        }
        if (stockError) {
            return res.status(400).json({ error: 'One or more items are out of stock.' });
        }

        // --- DECREMENT STOCK FOR ALL ITEMS ---
        for (const productId in cartCount) {
            const product = db.products.find(p => p.id === productId);
            if (product && product.type === 'tshirt') {
                for (const style in cartCount[productId]) {
                    for (const size in cartCount[productId][style]) {
                        db.inventory.products[productId][style][size] -= cartCount[productId][style][size];
                        if (db.inventory.products[productId][style][size] < 0) db.inventory.products[productId][style][size] = 0;
                    }
                }
            } else {
                for (const size in cartCount[productId]) {
                    db.inventory.products[productId][size] -= cartCount[productId][size];
                    if (db.inventory.products[productId][size] < 0) db.inventory.products[productId][size] = 0;
                }
            }
        }

        // Add order with timestamp
        order.date = new Date().toISOString();
        db.orders = db.orders || [];
        db.orders.push(order);

        writeDB(db);
        res.json({ success: true });
    } catch (error) {
        console.error('Order processing error:', error);
        res.status(500).json({ error: 'Failed to process order' });
    }
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
    res.json(db.inventory || { products: {} });
});

app.post('/api/inventory/bulk', (req, res) => {
    try {
        backupDB();
        const db = readDB();
        db.inventory = {
            products: req.body.products || {}  // Only accept products inventory
        };
        writeDB(db);
        res.json({ success: true });
    } catch (error) {
        console.error('Inventory update error:', error);
        res.status(500).json({ error: 'Failed to update inventory' });
    }
});

app.post('/api/inventory/product/:id', (req, res) => {
    try {
        backupDB();
        const db = readDB();
        const { id } = req.params;
        
        if (!db.inventory.products) {
            db.inventory.products = {};
        }
        
        db.inventory.products[id] = req.body;
        writeDB(db);
        res.json({ success: true });
    } catch (error) {
        console.error('Product inventory update error:', error);
        res.status(500).json({ error: 'Failed to update product inventory' });
    }
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