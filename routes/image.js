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
