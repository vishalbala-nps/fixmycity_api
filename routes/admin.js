const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db'); 
const admin = require('../firebase');
const multer = require('multer');
const path = require('path');
const storage = multer({ dest: path.join(__dirname, "..", "uploads") });

/**
 * @openapi
 * /api/admin/auth:
 *   post:
 *     summary: Authenticate admin user (Admin Only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Firebase ID token
 *     responses:
 *       200:
 *         description: Admin authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 token:
 *                   type: string
 *       400:
 *         description: idToken is required in body
 *       401:
 *         description: Invalid or expired idToken
 *       403:
 *         description: User is not an admin
 *       500:
 *         description: Database error
 */
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

/**
 * @openapi
 * /api/admin/issue:
 *   get:
 *     summary: Get all reports (Admin Only)
 *     responses:
 *       200:
 *         description: List of reports from IssueView
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: integer }
 *                   dateofreport: { type: string }
 *                   type: { type: string }
 *                   description: { type: string }
 *                   department:
 *                     type: string
 *                     enum: ["Department of Drinking Water and Sanitation", "Department of Rural Works", "Department of Road Construction", "Department of Energy", "Department of Health, Medical Education & Family Welfare"]
 *                   count: { type: integer }
 *                   status: { type: string }
 *                   lat: { type: number }
 *                   lon: { type: number }
 *                   images:
 *                     type: array
 *                     items: { type: string }
 *       500:
 *         description: Database error
 */
router.get('/issue', (req, res) => {
    db.query(
        `SELECT 
            id, 
            dateofreport, 
            type, 
            description, 
            department,
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
                department: r.department,
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

/**
 * @openapi
 * /api/admin/issue:
 *   post:
 *     summary: Update report status (Admin Only)
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [submitted, progress, complete, rejected]
 *               report:
 *                 type: integer
 *               image:
 *                 type: string
 *                 format: binary
 *               remarks:
 *                 type: string
 *     responses:
 *       200:
 *         description: Report status updated
 *       400:
 *         description: status and report are required or invalid status value
 *       404:
 *         description: Report not found
 *       500:
 *         description: Database error
 */
router.post('/issue', storage.single('image'), (req, res) => {
    const { status, report, remarks } = req.body;
    const allowedStatuses = ['submitted', 'progress', 'complete', 'rejected'];
    const image = req.file ? req.file.filename : null;

    if (!status || !report) {
        return res.status(400).json({ error: 'status and report are required' });
    }
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
    }
    // If status is complete, image and remarks are required
    if (status === 'complete' && (!image || !remarks)) {
        return res.status(400).json({ error: 'image and remarks are required when status is complete' });
    }
    // Update Reports and, if status is 'complete', insert into ResolvedIssues
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
            if (status === 'complete') {
                db.query(
                    `INSERT INTO ResolvedIssues (report, dateofresolution, image, remarks)
                     VALUES (?, CURDATE(), ?, ?)`,
                    [report, image, remarks],
                    (err2) => {
                        if (err2) {
                            console.error("Database update error (ResolvedIssues):", err2);
                            return res.status(500).json({ error: 'Database error (ResolvedIssues)' });
                        }
                        return res.status(200).json({ message: 'Report status and resolution updated' });
                    }
                );
            } else if (status === 'rejected') {
                return res.status(200).json({ message: 'Report status updated to rejected' });
            } else {
                return res.status(200).json({ message: 'Report status updated' });
            }
        }
    );
});

module.exports = router;
