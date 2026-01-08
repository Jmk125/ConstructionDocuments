/**
 * Check the actual pdf-parse API
 */

const pdfParse = require('pdf-parse');

console.log('Checking PDFParse class API...\n');

if (pdfParse.PDFParse) {
  console.log('PDFParse class found!');
  console.log('Type:', typeof pdfParse.PDFParse);

  // Check prototype methods
  console.log('\nPrototype methods:');
  const proto = pdfParse.PDFParse.prototype;
  console.log(Object.getOwnPropertyNames(proto).filter(name => name !== 'constructor'));

  // Try to instantiate
  try {
    const parser = new pdfParse.PDFParse();
    console.log('\n✓ Successfully instantiated PDFParse');
    console.log('Instance methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(parser)).filter(name => name !== 'constructor'));
  } catch (error) {
    console.error('\n✗ Error instantiating:', error.message);
  }
} else {
  console.log('PDFParse class not found');
}

// Check package.json to see what's actually installed
const fs = require('fs');
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
console.log('\nInstalled pdf-parse version:', packageJson.dependencies['pdf-parse']);

// Try to read node_modules version
try {
  const pdfPackage = JSON.parse(fs.readFileSync('./node_modules/pdf-parse/package.json', 'utf8'));
  console.log('Actual installed version:', pdfPackage.version);
  console.log('Package name:', pdfPackage.name);
  console.log('Main entry:', pdfPackage.main);
} catch (error) {
  console.log('Could not read pdf-parse package.json');
}
