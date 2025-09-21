/**
 * @openapi
 * /api/image/{imagename}:
 *   get:
 *     summary: Get an image by filename
 *     parameters:
 *       - in: path
 *         name: imagename
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the image file to retrieve
 *     responses:
 *       200:
 *         description: The image file
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Image not found
 */

const express = require('express');
const router = express.Router();
const path = require('path');

router.get('/:imagename', (req, res) => {
    const imagename = req.params.imagename;
    const imagePath = path.join(__dirname,"..",'uploads', imagename);
    res.sendFile(imagePath, err => {
        if (err) {
            res.status(404).json({ error: 'Image not found' });
        }
    });
});

module.exports = router;
