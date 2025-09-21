const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db'); 
const admin = require('../firebase');

router.post('/auth', (req, res) => {
    if (!req.body || typeof req.body !== 'object' || !req.body.idToken) {
        return res.status(400).json({ error: 'idToken is required in body' });
    }
    const { idToken } = req.body;
    admin.auth().verifyIdToken(idToken)
    .then((decodedToken) => {
        const uid = decodedToken.uid;
        // Check if the user is an admin in your database
        db.query("SELECT id from Admin where id=?", [uid], (err, results) => {
            if (err) {
                console.error("Database error:", err);
                return res.status(500).json({ error: 'Database error' });
            }
            if (results.length === 0) {
                return res.status(403).json({ error: 'User is not an admin' });
            }
            // User is an admin, generate a JWT for session management
            const token = jwt.sign({ user:uid, admin: true }, process.env.JWT_SECRET, { expiresIn: '30d' });
            return res.status(200).json({ message: 'Admin authenticated', token });
        });
    })
    .catch((error) => {
        console.error("Token verification error:", error);
        return res.status(401).json({ error: 'Invalid or expired idToken' });
    });
});

router.get('/issue', (req, res) => {
    db.query(
        `SELECT 
            id, 
            dateofreport, 
            type, 
            description, 
            count, 
            status, 
            lat,
            lon,
            images
        FROM IssueView
        ORDER BY dateofreport DESC`,
        (err, results) => {
            if (err) {
                console.error("Database query error:", err);
                return res.status(500).json({ error: 'Database error' });
            }
            const formatted = results.map(r => ({
                id: r.id,
                dateofreport: r.dateofreport,
                type: r.type,
                description: r.description,
                count: r.count,
                status: r.status,
                lat: r.lat,
                lon: r.lon,
                images: r.images ? r.images.split(',') : []
            }));
            res.json(formatted);
        }
    );
});

router.post('/issue', (req, res) => {
    const { status, report } = req.body;
    const allowedStatuses = ['submitted', 'progress', 'complete'];
    if (!status || !report) {
        return res.status(400).json({ error: 'status and report are required' });
    }
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
    }
    db.query(
        "UPDATE Reports SET status = ? WHERE id = ?",
        [status, report],
        (err, result) => {
            if (err) {
                console.error("Database update error:", err);
                return res.status(500).json({ error: 'Database error' });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Report not found' });
            }
            return res.status(200).json({ message: 'Report status updated' });
        }
    );
});

module.exports = router;
