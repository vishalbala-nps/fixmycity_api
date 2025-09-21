require('dotenv').config();

const express = require('express');
const cors = require("cors");
const db = require('./db'); // Import db from db.js
const path = require('path');
const jwt = require('jsonwebtoken');
const admin = require('./firebase');
const swaggerUi = require('swagger-ui-express');
const swaggerjson = require('./swagger.json'); 
const app = express();

app.use(cors());
app.use(express.json());

// Firebase Auth middleware
function authenticateCitizen(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    admin.auth().verifyIdToken(idToken)
        .then(decodedToken => {
            req.user = decodedToken.uid; // Only set user id
            next();
        })
        .catch(() => {
            res.status(401).json({ error: 'Invalid or expired token' });
        });
}

function authenticateAdmin(req, res, next) {
    if (req.originalUrl === '/api/admin/auth') {
        return next();
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.admin) {
            req.user = decoded.user; // Set user id
            next();
        } else {
            return res.status(403).json({ error: 'User is not an admin' });
        }
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

//Routes
const issueRouter = require('./routes/issue');
const imageRouter = require('./routes/image');
const adminRouter = require('./routes/admin');

app.use('/api/issue', authenticateCitizen, issueRouter);
app.use('/api/image', imageRouter);
app.use('/api/admin', authenticateAdmin, adminRouter);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerjson));

// Serve images by filename
app.get('/api/image/:imagename', (req, res) => {
    const imagename = req.params.imagename;
    const imagePath = path.join(__dirname, 'uploads', imagename);
    res.sendFile(imagePath, err => {
        if (err) {
            res.status(404).json({ error: 'Image not found' });
        }
    });
});

db.connect(function(err) {
    if (err) {
        console.error("Error connecting to database:", err);
        return;
    }
    console.log("Connected to database");
    app.listen(process.env.PORT, function() {
        console.log("Server is running");
    });
});