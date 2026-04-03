#!/usr/bin/env node
/**
 * Regression check: annotation delete route precedence.
 *
 * This verifies two invariants:
 * 1) server mount order has annotationRoutes before datasetRoutes under /api/dataset
 * 2) dataset version delete route contains the "annotations" guard middleware
 */

const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'server.js');
const datasetsRoutePath = path.join(root, 'routes', 'datasets.js');

const serverText = fs.readFileSync(serverPath, 'utf8');
const datasetsText = fs.readFileSync(datasetsRoutePath, 'utf8');

const annotationMount = "app.use('/api/dataset', annotationRoutes);";
const datasetMount = "app.use('/api/dataset', datasetRoutes);";

const annotationMountIdx = serverText.indexOf(annotationMount);
const datasetMountIdx = serverText.indexOf(datasetMount);

if (annotationMountIdx === -1) {
  fail('Annotation route mount not found in server.js');
}
if (datasetMountIdx === -1) {
  fail('Dataset route mount not found in server.js');
}
if (annotationMountIdx > datasetMountIdx) {
  fail('Annotation routes are mounted after dataset routes; precedence is unsafe');
}
pass('Annotation routes mount before dataset routes');

const hasVersionDeleteRoute = datasetsText.includes("router.delete(\n  '/:company/:project/:version'");
if (!hasVersionDeleteRoute) {
  fail('Dataset version delete route not found in routes/datasets.js');
}

const hasAnnotationsGuard =
  datasetsText.includes("String(req.params.project).toLowerCase() === 'annotations'") &&
  datasetsText.includes("return next('route');");

if (!hasAnnotationsGuard) {
  fail("Dataset version delete route is missing the 'annotations' guard");
}
pass("Dataset version delete route has 'annotations' guard");

console.log('All route precedence regression checks passed.');
