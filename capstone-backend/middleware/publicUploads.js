const express = require('express');
const path = require('path');

module.exports = function publicUploads(directory) {
  const serve = express.static(directory);
  return (req, res, next) => {
    let pathname;
    try { pathname = path.posix.normalize(decodeURIComponent(req.path).replace(/\\/g, '/')).toLowerCase(); }
    catch (_) { return res.sendStatus(400); }
    if (pathname === '/lab-results' || pathname.startsWith('/lab-results/')) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ message: 'Open medical files through the signed-in dashboard.' });
    }
    return serve(req, res, next);
  };
};
